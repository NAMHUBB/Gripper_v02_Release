use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use tokio_modbus::{
    client::rtu,
    prelude::{Reader, Slave, Writer}, // Client 제거 (unused)
};
use tokio_serial::{
    available_ports, DataBits, FlowControl, Parity, SerialPortBuilderExt, StopBits,
};

type CommandResult<T> = Result<T, String>;

// ── Config ────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusRtuConfig {
    com_port: String,
    baud_rate: u32,
    slave_id: u8,
    #[serde(default = "default_parity")]
    parity: String, // "None" | "Even" | "Odd"
    #[serde(default = "default_stop_bits")]
    stop_bits: u8, // 1 | 2
}

fn default_parity() -> String {
    "None".to_string()
}
fn default_stop_bits() -> u8 {
    1
}

// ── State ─────────────────────────────────────────────────────────────────────
struct ModbusConnection {
    context: tokio_modbus::client::Context,
    config: ModbusRtuConfig,
}

#[derive(Default)]
struct ModbusConnectionState {
    connection: Mutex<Option<ModbusConnection>>,
}

// ── Response types ────────────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusConnectionStatus {
    connected: bool,
    config: Option<ModbusRtuConfig>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusPlotData {
    position_echo: i16,
    position_actual: i16,
    force_actual: i16,
}

// ── Serial helpers ────────────────────────────────────────────────────────────
fn parse_parity(s: &str) -> Parity {
    match s {
        "Even" => Parity::Even,
        "Odd" => Parity::Odd,
        _ => Parity::None,
    }
}

fn parse_stop_bits(n: u8) -> StopBits {
    if n == 2 {
        StopBits::Two
    } else {
        StopBits::One
    }
}

fn create_serial_builder(config: &ModbusRtuConfig) -> tokio_serial::SerialPortBuilder {
    tokio_serial::new(config.com_port.clone(), config.baud_rate)
        .data_bits(DataBits::Eight)
        .parity(parse_parity(&config.parity))
        .stop_bits(parse_stop_bits(config.stop_bits))
        .flow_control(FlowControl::None)
}

// ── Modbus helpers ────────────────────────────────────────────────────────────
fn map_modbus_result<T>(result: tokio_modbus::Result<T>) -> CommandResult<T> {
    let response = result.map_err(|err| format!("Modbus transport error: {err}"))?;
    response.map_err(|err| format!("Modbus exception: {err}"))
}

fn word_to_i16(word: u16) -> i16 {
    word as i16
}

fn to_i16_values(words: Vec<u16>, quantity: u16) -> CommandResult<Vec<i16>> {
    if words.len() != quantity as usize {
        return Err(format!(
            "Unexpected register count: expected {}, received {}",
            quantity,
            words.len()
        ));
    }
    Ok(words.into_iter().map(word_to_i16).collect())
}

fn validate_quantity(quantity: u16) -> CommandResult<u16> {
    if quantity == 0 {
        return Err("quantity must be greater than 0".to_string());
    }
    if quantity > 125 {
        return Err("quantity exceeds Modbus max (125)".to_string());
    }
    Ok(quantity)
}

async fn read_input_i16(
    context: &mut tokio_modbus::client::Context,
    address: u16,
) -> CommandResult<i16> {
    let words = map_modbus_result(context.read_input_registers(address, 1).await)?;
    if words.len() != 1 {
        return Err(format!(
            "Unexpected register count at address {}: {}",
            address,
            words.len()
        ));
    }
    Ok(word_to_i16(words[0]))
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn modbus_list_serial_ports() -> CommandResult<Vec<String>> {
    let ports =
        available_ports().map_err(|err| format!("Failed to enumerate serial ports: {err}"))?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

#[tauri::command]
async fn modbus_connect(
    state: State<'_, ModbusConnectionState>,
    config: ModbusRtuConfig,
) -> CommandResult<ModbusConnectionStatus> {
    let port = create_serial_builder(&config)
        .open_native_async()
        .map_err(|err| format!("Failed to open {}: {err}", config.com_port))?;

    let context = rtu::attach_slave(port, Slave(config.slave_id));

    let mut guard = state.connection.lock().await;
    if let Some(conn) = guard.as_mut() {
        let _ = conn.context.disconnect().await;
    }
    *guard = Some(ModbusConnection {
        context,
        config: config.clone(),
    });

    Ok(ModbusConnectionStatus {
        connected: true,
        config: Some(config),
    })
}

#[tauri::command]
async fn modbus_disconnect(
    state: State<'_, ModbusConnectionState>,
) -> CommandResult<ModbusConnectionStatus> {
    let mut guard = state.connection.lock().await;
    if let Some(mut conn) = guard.take() {
        let _ = conn.context.disconnect().await;
    }
    Ok(ModbusConnectionStatus {
        connected: false,
        config: None,
    })
}

#[tauri::command]
async fn modbus_connection_status(
    state: State<'_, ModbusConnectionState>,
) -> CommandResult<ModbusConnectionStatus> {
    let guard = state.connection.lock().await;
    match guard.as_ref() {
        Some(conn) => Ok(ModbusConnectionStatus {
            connected: true,
            config: Some(conn.config.clone()),
        }),
        None => Ok(ModbusConnectionStatus {
            connected: false,
            config: None,
        }),
    }
}

#[tauri::command]
async fn modbus_read_input_registers(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    quantity: u16,
) -> CommandResult<Vec<i16>> {
    let qty = validate_quantity(quantity)?;
    let mut guard = state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "Modbus is not connected".to_string())?;
    let words = map_modbus_result(conn.context.read_input_registers(address, qty).await)?;
    to_i16_values(words, quantity)
}

#[tauri::command]
async fn modbus_read_holding_registers(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    quantity: u16,
) -> CommandResult<Vec<i16>> {
    let qty = validate_quantity(quantity)?;
    let mut guard = state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "Modbus is not connected".to_string())?;
    let words = map_modbus_result(conn.context.read_holding_registers(address, qty).await)?;
    to_i16_values(words, quantity)
}

#[tauri::command]
async fn modbus_write_single_register(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    value: i16,
) -> CommandResult<()> {
    let mut guard = state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "Modbus is not connected".to_string())?;
    map_modbus_result(
        conn.context
            .write_single_register(address, value as u16)
            .await,
    )?;
    Ok(())
}

#[tauri::command]
async fn modbus_read_plot_registers(
    state: State<'_, ModbusConnectionState>,
) -> CommandResult<ModbusPlotData> {
    let mut guard = state.connection.lock().await;
    let conn = guard
        .as_mut()
        .ok_or_else(|| "Modbus is not connected".to_string())?;

    let position_echo = read_input_i16(&mut conn.context, 2003).await?;
    let position_actual = read_input_i16(&mut conn.context, 2004).await?;
    let force_actual = read_input_i16(&mut conn.context, 2005).await?;

    Ok(ModbusPlotData {
        position_echo,
        position_actual,
        force_actual,
    })
}

// ── Entry point ───────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ModbusConnectionState::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_tcp::init())
        .invoke_handler(tauri::generate_handler![
            modbus_list_serial_ports,
            modbus_connect,
            modbus_disconnect,
            modbus_connection_status,
            modbus_read_input_registers,
            modbus_read_holding_registers,
            modbus_write_single_register,
            modbus_read_plot_registers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
