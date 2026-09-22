use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::{Arc, Mutex as StdMutex};
use std::task::{Context as TaskContext, Poll};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tokio_modbus::{
    client::rtu,
    prelude::{Reader, Slave, Writer},
};
use tokio_serial::{
    available_ports, DataBits, FlowControl, Parity, SerialPortBuilderExt, StopBits,
};

type CommandResult<T> = Result<T, String>;

/// Modbus 통신이 응답 없이 무한 대기하는 것을 방지하기 위한 타임아웃.
const MODBUS_TIMEOUT: Duration = Duration::from_millis(800);

/// 시리얼 포트 열기/닫기는 OS 드라이버 안에서 동기적으로 블로킹된다.
/// (macOS 의 일부 USB-시리얼/Bluetooth 포트, Windows 의 CreateFile 등은 수 초씩 멈추기도 한다.)
/// 그 동안 커넥션 뮤텍스와 UI 의 "연결 중" 상태가 영원히 잠기지 않도록 상한을 둔다.
const SERIAL_OPEN_TIMEOUT: Duration = Duration::from_secs(3);
const SERIAL_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

/// 같은 커넥션에서 연속으로 두 프레임을 보낼 때의 간격.
/// Modbus RTU 는 프레임 사이 3.5 문자 이상의 침묵을 요구하고, 슬레이브(STM32)가
/// 응답을 다 보낸 뒤 수신 DMA 를 다시 준비할 시간도 필요하다. 간격 없이 바로
/// 다음 요청을 보내면 요청이 유실되어 타임아웃(800ms)까지 기다리게 된다.
const INTER_FRAME_GAP: Duration = Duration::from_millis(5);

/// 진단 메시지에 남길 마지막 송신/수신 바이트 수.
const WIRE_HISTORY_BYTES: usize = 32;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusRtuConfig {
    com_port: String,
    baud_rate: u32,
    slave_id: u8,
}

struct ModbusConnection {
    context: tokio_modbus::client::Context,
    config: ModbusRtuConfig,
    /// 선로에 실제로 오간 바이트 기록. 타임아웃이 "응답 없음"인지 "깨진 응답"인지 가려낸다.
    wire: WireMonitor,
}

#[derive(Default)]
struct ModbusConnectionState {
    connection: Mutex<Option<ModbusConnection>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusConnectionStatus {
    connected: bool,
    config: Option<ModbusRtuConfig>,
}

/// 모니터/플롯 폴링 한 사이클에 필요한 레지스터를 한 번의 뮤텍스 점유 안에서 읽어온 결과.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModbusMonitorData {
    inputs: Vec<i16>,
    /// `holding_quantity` 가 0 이면 읽지 않고 `None`.
    holdings: Option<Vec<i16>>,
}

// ---------------------------------------------------------------------------
// 선로 진단: 시리얼 스트림을 감싸 송수신 바이트를 기록한다
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct WireStats {
    tx_bytes: u64,
    rx_bytes: u64,
    last_tx: VecDeque<u8>,
    last_rx: VecDeque<u8>,
}

#[derive(Clone, Copy)]
struct WireSnapshot {
    tx_bytes: u64,
    rx_bytes: u64,
}

#[derive(Debug, Clone, Default)]
struct WireMonitor {
    stats: Arc<StdMutex<WireStats>>,
}

fn push_history(history: &mut VecDeque<u8>, bytes: &[u8]) {
    for byte in bytes {
        if history.len() == WIRE_HISTORY_BYTES {
            history.pop_front();
        }
        history.push_back(*byte);
    }
}

fn hex_string(bytes: impl Iterator<Item = u8>) -> String {
    bytes
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

impl WireMonitor {
    fn lock(&self) -> std::sync::MutexGuard<'_, WireStats> {
        self.stats.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn snapshot(&self) -> WireSnapshot {
        let stats = self.lock();
        WireSnapshot {
            tx_bytes: stats.tx_bytes,
            rx_bytes: stats.rx_bytes,
        }
    }

    fn record_tx(&self, bytes: &[u8]) {
        let mut stats = self.lock();
        stats.tx_bytes += bytes.len() as u64;
        push_history(&mut stats.last_tx, bytes);
    }

    fn record_rx(&self, bytes: &[u8]) {
        let mut stats = self.lock();
        stats.rx_bytes += bytes.len() as u64;
        push_history(&mut stats.last_rx, bytes);
    }

    /// 스냅샷 이후 오간 바이트를 사람이 읽을 수 있게 요약한다.
    fn describe_since(&self, before: WireSnapshot) -> String {
        let stats = self.lock();
        let tx = stats.tx_bytes.saturating_sub(before.tx_bytes);
        let rx = stats.rx_bytes.saturating_sub(before.rx_bytes);

        if rx == 0 {
            return format!(
                "TX {tx} B, RX 0 B: 슬레이브 응답 없음 (배선(A/B, TX/RX)·전원·펌웨어 실행 여부·ID/baud 확인)"
            );
        }

        let rx_tail: Vec<u8> = {
            let take = (rx as usize).min(stats.last_rx.len());
            stats.last_rx.iter().rev().take(take).rev().copied().collect()
        };
        let tx_tail: Vec<u8> = {
            let take = (tx as usize).min(stats.last_tx.len());
            stats.last_tx.iter().rev().take(take).rev().copied().collect()
        };
        let echoed = !tx_tail.is_empty() && rx_tail.starts_with(&tx_tail);
        let mut text = format!(
            "TX {tx} B, RX {rx} B: {}",
            hex_string(rx_tail.iter().copied())
        );
        if echoed {
            let only_echo = rx_tail.len() == tx_tail.len();
            text.push_str(if only_echo {
                " (보낸 요청이 그대로 되돌아옴 = 어댑터 에코, 슬레이브 응답 없음)"
            } else {
                " (앞부분은 어댑터 에코)"
            });
        } else {
            text.push_str(" (유효한 프레임이 아님: baud 불일치/노이즈 가능성)");
        }
        text
    }
}

/// 시리얼 스트림을 감싸 오가는 바이트를 `WireMonitor` 에 기록한다.
/// (tokio-modbus 0.14 의 `attach_slave` 는 transport 에 `Debug` 를 요구한다.)
#[derive(Debug)]
struct WireTap<T> {
    inner: T,
    monitor: WireMonitor,
}

impl<T: AsyncRead + Unpin> AsyncRead for WireTap<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let this = &mut *self;
        let poll = Pin::new(&mut this.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &poll {
            let filled = buf.filled();
            if filled.len() > before {
                this.monitor.record_rx(&filled[before..]);
            }
        }
        poll
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for WireTap<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = &mut *self;
        let poll = Pin::new(&mut this.inner).poll_write(cx, data);
        if let Poll::Ready(Ok(written)) = &poll {
            this.monitor.record_tx(&data[..*written]);
        }
        poll
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

// ---------------------------------------------------------------------------
// 공용 헬퍼
// ---------------------------------------------------------------------------

fn create_serial_builder(config: &ModbusRtuConfig) -> tokio_serial::SerialPortBuilder {
    tokio_serial::new(config.com_port.clone(), config.baud_rate)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
}

/// Modbus 작업을 타임아웃과 함께 실행한다. 응답이 없으면 뮤텍스를 계속 붙잡지 않고
/// 에러를 반환하며, 전송 계층 오류/타임아웃에는 선로 진단(송수신 바이트)을 덧붙인다.
async fn run_modbus<F, T>(wire: &WireMonitor, fut: F) -> CommandResult<T>
where
    F: std::future::Future<Output = tokio_modbus::Result<T>>,
{
    let before = wire.snapshot();
    match timeout(MODBUS_TIMEOUT, fut).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(exception))) => Err(format!("Modbus exception: {exception}")),
        Ok(Err(transport)) => Err(format!(
            "Modbus transport error: {transport} [{}]",
            wire.describe_since(before)
        )),
        Err(_) => Err(format!(
            "Modbus operation timed out [{}]",
            wire.describe_since(before)
        )),
    }
}

fn word_to_i16(word: u16) -> i16 {
    word as i16
}

fn to_i16_values(words: Vec<u16>, quantity: u16) -> CommandResult<Vec<i16>> {
    let expected_words = quantity as usize;
    if words.len() != expected_words {
        return Err(format!(
            "Unexpected register count: expected {}, received {}",
            expected_words,
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
        return Err("quantity is too large for Modbus read (max 125)".to_string());
    }

    Ok(quantity)
}

fn locked(guard: &mut Option<ModbusConnection>) -> CommandResult<&mut ModbusConnection> {
    guard
        .as_mut()
        .ok_or_else(|| "Modbus is not connected".to_string())
}

/// 시리얼 포트를 연다.
///
/// `open_native_async()` 는 open(2)/termios 설정을 동기적으로 수행하므로 blocking 스레드에서
/// 실행하고, 드라이버가 멈추더라도 `SERIAL_OPEN_TIMEOUT` 뒤에는 에러로 돌아오게 한다.
/// (tokio 의 blocking 스레드는 런타임 컨텍스트를 갖고 있어 그 안에서 비동기 fd 등록이 가능하다.)
async fn open_serial_port(config: &ModbusRtuConfig) -> CommandResult<tokio_serial::SerialStream> {
    let builder = create_serial_builder(config);
    let port_name = config.com_port.clone();

    let open_task = tokio::task::spawn_blocking(move || builder.open_native_async());
    match timeout(SERIAL_OPEN_TIMEOUT, open_task).await {
        Ok(Ok(Ok(port))) => Ok(port),
        Ok(Ok(Err(err))) => Err(format!("Failed to open serial port {port_name}: {err}")),
        Ok(Err(join_err)) => Err(format!("Failed to open serial port {port_name}: {join_err}")),
        Err(_) => Err(format!(
            "Timed out opening serial port {port_name} ({}s)",
            SERIAL_OPEN_TIMEOUT.as_secs()
        )),
    }
}

/// 열린 포트에 Modbus RTU 클라이언트와 선로 기록기를 붙인다.
fn attach_connection(port: tokio_serial::SerialStream, config: ModbusRtuConfig) -> ModbusConnection {
    let wire = WireMonitor::default();
    let tap = WireTap {
        inner: port,
        monitor: wire.clone(),
    };
    ModbusConnection {
        context: rtu::attach_slave(tap, Slave(config.slave_id)),
        config,
        wire,
    }
}

/// 커넥션을 닫는다. flush 와 close(2) 가 드라이버 안에서 멈추더라도 호출자는
/// `SERIAL_CLOSE_TIMEOUT` 안에 돌아온다. (그 경우 실제 close 는 blocking 스레드에서 마저 진행된다.)
async fn close_connection(mut connection: ModbusConnection) {
    let _ = timeout(SERIAL_CLOSE_TIMEOUT, connection.context.disconnect()).await;
    let close_task = tokio::task::spawn_blocking(move || drop(connection));
    let _ = timeout(SERIAL_CLOSE_TIMEOUT, close_task).await;
}

// ---------------------------------------------------------------------------
// Tauri 커맨드
// ---------------------------------------------------------------------------

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 포트 열거는 OS API(IOKit/SetupAPI)를 동기 호출하며 수백 ms 이상 걸릴 수 있다.
/// 동기 커맨드는 메인(UI) 스레드에서 실행되므로 blocking 스레드로 넘긴다.
#[tauri::command]
async fn modbus_list_serial_ports() -> CommandResult<Vec<String>> {
    let ports = tokio::task::spawn_blocking(available_ports)
        .await
        .map_err(|err| format!("Failed to enumerate serial ports: {err}"))?
        .map_err(|err| format!("Failed to enumerate serial ports: {err}"))?;
    Ok(ports.into_iter().map(|port| port.port_name).collect())
}

#[tauri::command]
async fn modbus_connect(
    state: State<'_, ModbusConnectionState>,
    config: ModbusRtuConfig,
) -> CommandResult<ModbusConnectionStatus> {
    if config.com_port.trim().is_empty() {
        return Err("No serial port selected".to_string());
    }
    if config.slave_id == 0 {
        return Err("Slave ID 0 is the broadcast address; use 1~247".to_string());
    }

    let mut guard = state.connection.lock().await;

    // 기존 연결이 있으면 새 포트를 열기 *전에* 닫는다. 같은 포트를 다시 여는 경우
    // 배타 잠금(TIOCEXCL) 때문에 기존 핸들이 살아 있는 동안은 열기가 실패한다.
    if let Some(previous) = guard.take() {
        close_connection(previous).await;
    }

    let port = open_serial_port(&config).await?;
    *guard = Some(attach_connection(port, config.clone()));

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
    if let Some(connection) = guard.take() {
        close_connection(connection).await;
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
    if let Some(connection) = guard.as_ref() {
        Ok(ModbusConnectionStatus {
            connected: true,
            config: Some(connection.config.clone()),
        })
    } else {
        Ok(ModbusConnectionStatus {
            connected: false,
            config: None,
        })
    }
}

#[tauri::command]
async fn modbus_read_input_registers(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    quantity: u16,
) -> CommandResult<Vec<i16>> {
    let word_count = validate_quantity(quantity)?;
    let mut guard = state.connection.lock().await;
    let connection = locked(&mut guard)?;

    let words = run_modbus(
        &connection.wire,
        connection.context.read_input_registers(address, word_count),
    )
    .await?;
    to_i16_values(words, quantity)
}

#[tauri::command]
async fn modbus_read_holding_registers(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    quantity: u16,
) -> CommandResult<Vec<i16>> {
    let word_count = validate_quantity(quantity)?;
    let mut guard = state.connection.lock().await;
    let connection = locked(&mut guard)?;

    let words = run_modbus(
        &connection.wire,
        connection
            .context
            .read_holding_registers(address, word_count),
    )
    .await?;
    to_i16_values(words, quantity)
}

#[tauri::command]
async fn modbus_write_single_register(
    state: State<'_, ModbusConnectionState>,
    address: u16,
    value: i16,
) -> CommandResult<()> {
    let mut guard = state.connection.lock().await;
    let connection = locked(&mut guard)?;

    run_modbus(
        &connection.wire,
        connection
            .context
            .write_single_register(address, value as u16),
    )
    .await?;
    Ok(())
}

/// 폴링 한 사이클: 입력 레지스터 블록 하나를 읽고, `holding_quantity > 0` 이면
/// 프레임 간격을 둔 뒤 홀딩 레지스터 블록도 이어서 읽는다.
///
/// 두 요청을 프론트에서 따로 invoke 하면 뮤텍스 순서에 따라 프레임이 간격 없이
/// 붙어 나가거나 다른 커맨드가 끼어들 수 있어, 한 번의 뮤텍스 점유 안에서 처리한다.
#[tauri::command]
async fn modbus_read_monitor_registers(
    state: State<'_, ModbusConnectionState>,
    input_address: u16,
    input_quantity: u16,
    holding_address: u16,
    holding_quantity: u16,
) -> CommandResult<ModbusMonitorData> {
    let input_count = validate_quantity(input_quantity)?;
    let holding_count = if holding_quantity == 0 {
        None
    } else {
        Some(validate_quantity(holding_quantity)?)
    };

    let mut guard = state.connection.lock().await;
    let connection = locked(&mut guard)?;

    let inputs = to_i16_values(
        run_modbus(
            &connection.wire,
            connection
                .context
                .read_input_registers(input_address, input_count),
        )
        .await?,
        input_quantity,
    )?;

    let holdings = match holding_count {
        Some(count) => {
            sleep(INTER_FRAME_GAP).await;
            Some(to_i16_values(
                run_modbus(
                    &connection.wire,
                    connection
                        .context
                        .read_holding_registers(holding_address, count),
                )
                .await?,
                holding_quantity,
            )?)
        }
        None => None,
    };

    Ok(ModbusMonitorData { inputs, holdings })
}

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
            greet,
            modbus_list_serial_ports,
            modbus_connect,
            modbus_disconnect,
            modbus_connection_status,
            modbus_read_input_registers,
            modbus_read_holding_registers,
            modbus_write_single_register,
            modbus_read_monitor_registers
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 실장비 없이 PTY 쌍으로 시리얼 열기 → Modbus 읽기 → 타임아웃 → 닫기 경로를 검증한다.
/// (macOS 의 PTY 는 baud 설정 ioctl 을 거부하므로 baud_rate 0 으로 연다.)
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_serial::SerialPort as _;

    fn crc16(data: &[u8]) -> u16 {
        let mut crc: u16 = 0xFFFF;
        for byte in data {
            crc ^= u16::from(*byte);
            for _ in 0..8 {
                let odd = crc & 1 != 0;
                crc >>= 1;
                if odd {
                    crc ^= 0xA001;
                }
            }
        }
        crc
    }

    /// 슬레이브 흉내: FC03/FC04 요청에 "값 = 주소" 로 응답한다.
    /// 시작 주소 0xFFFF 는 무응답, 0xFFFE 는 요청을 그대로 되돌려 보낸다(어댑터 에코 흉내).
    async fn run_fake_slave(mut master: tokio_serial::SerialStream) {
        let mut pending: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 64];
        loop {
            match master.read(&mut chunk).await {
                Ok(0) | Err(_) => {
                    // 슬레이브 쪽 fd 가 아직 열리지 않았거나 닫힌 상태
                    sleep(Duration::from_millis(10)).await;
                    continue;
                }
                Ok(n) => pending.extend_from_slice(&chunk[..n]),
            }
            while pending.len() >= 8 {
                let frame: Vec<u8> = pending.drain(..8).collect();
                let (slave_id, function) = (frame[0], frame[1]);
                let address = u16::from_be_bytes([frame[2], frame[3]]);
                let quantity = u16::from_be_bytes([frame[4], frame[5]]);
                let crc = u16::from_le_bytes([frame[6], frame[7]]);
                if crc != crc16(&frame[..6]) || !(function == 3 || function == 4) {
                    continue;
                }
                if address == 0xFFFF {
                    continue;
                }
                if address == 0xFFFE {
                    let _ = master.write_all(&frame).await;
                    let _ = master.flush().await;
                    continue;
                }
                let mut response = vec![slave_id, function, (quantity * 2) as u8];
                for i in 0..quantity {
                    response.extend_from_slice(&address.wrapping_add(i).to_be_bytes());
                }
                response.extend_from_slice(&crc16(&response).to_le_bytes());
                let _ = master.write_all(&response).await;
                let _ = master.flush().await;
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opens_reads_times_out_and_closes_over_pty() {
        let (master, slave) = tokio_serial::SerialStream::pair().expect("pty pair");
        let slave_path = slave.name().expect("pty slave path");
        drop(slave);
        let responder = tokio::spawn(run_fake_slave(master));

        let config = ModbusRtuConfig {
            com_port: slave_path,
            baud_rate: 0,
            slave_id: 1,
        };
        let port = open_serial_port(&config).await.expect("open via spawn_blocking");
        let mut connection = attach_connection(port, config);

        // 모니터 커맨드와 같은 순서: 입력 블록 → 프레임 간격 → 홀딩 블록
        let inputs = run_modbus(
            &connection.wire,
            connection.context.read_input_registers(2000, 11),
        )
        .await
        .expect("input read");
        assert_eq!(inputs, (2000u16..2011).collect::<Vec<_>>());
        sleep(INTER_FRAME_GAP).await;
        let holdings = run_modbus(
            &connection.wire,
            connection.context.read_holding_registers(1000, 7),
        )
        .await
        .expect("holding read");
        assert_eq!(holdings, (1000u16..1007).collect::<Vec<_>>());

        // 무응답 → MODBUS_TIMEOUT 안에 에러로 돌아오고, 진단에 "RX 0" 이 실린다
        let started = Instant::now();
        let err = run_modbus(
            &connection.wire,
            connection.context.read_input_registers(0xFFFF, 1),
        )
        .await
        .expect_err("no response must time out");
        assert!(err.contains("timed out"), "unexpected error: {err}");
        assert!(err.contains("TX 8 B, RX 0 B"), "unexpected diagnostics: {err}");
        assert!(started.elapsed() < MODBUS_TIMEOUT + Duration::from_millis(300));

        // 에코만 돌아오는 경우: 타임아웃 진단이 에코를 짚어준다
        let err = run_modbus(
            &connection.wire,
            connection.context.read_input_registers(0xFFFE, 1),
        )
        .await
        .expect_err("echo only must time out");
        assert!(err.contains("어댑터 에코"), "unexpected diagnostics: {err}");

        // 타임아웃 뒤에도 커넥션은 계속 쓸 수 있다
        let adc0 = run_modbus(
            &connection.wire,
            connection.context.read_input_registers(2010, 1),
        )
        .await
        .expect("read after timeout");
        assert_eq!(adc0, vec![2010]);

        // 닫기는 제한 시간 안에 끝난다
        let started = Instant::now();
        close_connection(connection).await;
        assert!(started.elapsed() < SERIAL_CLOSE_TIMEOUT);

        responder.abort();
    }
}
