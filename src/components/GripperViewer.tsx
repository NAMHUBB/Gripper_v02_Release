import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';

interface Props {
  openRatio: number;
  tilt: number;
  spread: number;
  isMoving: boolean;
  statusColor: string;
  objectDetected: boolean;
  connected: boolean;
  activated: boolean;
  eStop: boolean;
}

const FRONT_ANGLE = 0.8;
const INIT_CAMERA = { x: 0, y: 0, z: -0.35 };
const MODEL_SIZE  = 0.2;
const FIT_PADDING = 1.2;
const MOTOR_MAX   = 0.81;
const URDF_URL    = '/robot/parallelgripper_urdf_v01.urdf';

const applyMimicJoints = (joints: Record<string, any>, motorValue: number) => {
  const set = (name: string, mult: number, offset = 0) => {
    if (joints[name]) joints[name].setJointValue(motorValue * mult + offset);
  };
  set('Gripper1_joint',         -0.0309848252, 0);
  set('Gipper2_joint',          -0.0309848252, 0);
  set('Rod End Bearing1_joint', -0.8625,       0.01);
  set('Rod End Bearing3_joint', -0.8625,       0.01);
};

const GripperViewer: React.FC<Props> = ({
  openRatio, isMoving, statusColor, objectDetected,
  connected, activated, eStop,
}) => {
  const mountRef     = useRef<HTMLDivElement>(null);
  const robotRef     = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const controlsRef  = useRef<any>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);

  const [isRotating, setIsRotating] = useState(false);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = isRotating;
  }, [isRotating]);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 100);
    camera.position.set(INIT_CAMERA.x, INIT_CAMERA.y, INIT_CAMERA.z);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(160, 200);
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.2;   // ← 1.2 → 2.2 (전체 밝기 상향)
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    import('three/examples/jsm/environments/RoomEnvironment.js')
      .then(({ RoomEnvironment }) => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.08).texture; // ← 0.04 → 0.08
        pmrem.dispose();
      })
      .catch(() => {});

    const applySize = () => {
      if (!mountRef.current) return;
      const W = mountRef.current.clientWidth;
      const H = mountRef.current.clientHeight;
      if (W > 0 && H > 0) {
        renderer.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      }
    };
    requestAnimationFrame(() => { applySize(); requestAnimationFrame(applySize); });
    const resizeObserver = new ResizeObserver(applySize);
    resizeObserver.observe(mountRef.current);

    // ── 조명 설정 (핑거가 아래를 향하므로 하단 조명 대폭 강화) ────────────────

    // 전체 환경광
    scene.add(new THREE.AmbientLight(0xffffff, 4.0));   // ← 2.0 → 4.0

    // 반구광: 위(하늘) → 아래(바닥) 방향 그라데이션 조명
    // 핑거 방향(아래)을 sky 색으로 설정해 핑거부 자동 조명
    const hemi = new THREE.HemisphereLight(
      0xffffff,   // sky color  (아래 방향 = 핑거 방향)
      0xaabbcc,   // ground color (위 방향)
      3.0,        // intensity
    );
    hemi.position.set(0, -1, 0);  // 핑거 방향(아래)이 sky
    scene.add(hemi);

    // 메인 키 라이트 (정면 + 약간 위)
    const key = new THREE.DirectionalLight(0xffffff, 4.0);  // ← 3.0 → 4.0
    key.position.set(1, 2, -2);   // ← 카메라 방향 고려해 앞쪽으로
    scene.add(key);

    // 핑거 전용 하단 조명 (핑거 방향인 아래에서 직접 비춤)
    const fingerLight = new THREE.DirectionalLight(0xffffff, 5.0);  // ← 강한 하단광
    fingerLight.position.set(0, -3, -1);
    scene.add(fingerLight);

    // 핑거 측면 보조광 1
    const side1 = new THREE.DirectionalLight(0xffffff, 3.0);
    side1.position.set(3, -2, -1);
    scene.add(side1);

    // 핑거 측면 보조광 2
    const side2 = new THREE.DirectionalLight(0xffffff, 3.0);
    side2.position.set(-3, -2, -1);
    scene.add(side2);

    // 후면 림 라이트 (윤곽 강조)
    const rim = new THREE.DirectionalLight(0xddeeff, 1.5);
    rim.position.set(0, 3, 2);
    scene.add(rim);

    import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping   = true;
      controls.dampingFactor   = 0.1;
      controls.enableZoom      = true;
      controls.enablePan       = true;
      controls.enableRotate    = true;
      controls.autoRotate      = false;
      controls.autoRotateSpeed = 2.0;
      controls.minDistance     = 0.05;
      controls.maxDistance     = 1.5;
      controls.saveState();
      controlsRef.current = controls;
    });

    const fitRobot = (robot: any) => {
      robot.updateMatrixWorld(true);
      const initialBox = new THREE.Box3().setFromObject(robot);
      const initialSize = initialBox.getSize(new THREE.Vector3());
      const initialMaxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);
      if (initialMaxDim <= 0) return;

      robot.scale.setScalar(MODEL_SIZE / initialMaxDim);
      robot.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(robot);
      const center = box.getCenter(new THREE.Vector3());
      robot.position.sub(center);
      robot.updateMatrixWorld(true);

      const size = box.getSize(new THREE.Vector3());
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = FIT_PADDING * Math.max(
        size.y / (2 * Math.tan(verticalFov / 2)),
        size.x / (2 * Math.tan(horizontalFov / 2)),
      );

      camera.position.set(0, 0, -Math.max(distance, size.z * FIT_PADDING));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
        controlsRef.current.saveState();
      }
    };

    const loader = new URDFLoader();
    loader.loadMeshCb = (
      path: string,
      manager: THREE.LoadingManager,
      done: (mesh: THREE.Object3D) => void
    ) => {
      import('three/examples/jsm/loaders/GLTFLoader.js')
        .then(({ GLTFLoader }) => {
          new GLTFLoader(manager).load(
            path,
            (gltf) => { done(gltf.scene); },
            undefined,
            (err) => { console.warn('Mesh 로드 실패:', path, err); done(new THREE.Group()); }
          );
        })
        .catch(() => done(new THREE.Group()));
    };

    loader.load(
      URDF_URL,
      (robot: any) => {
        robotRef.current = robot;
        robot.rotation.x = -Math.PI / 2;
        robot.rotation.z = FRONT_ANGLE;
        scene.add(robot);
        setTimeout(() => fitRobot(robot), 200);
      },
      undefined,
      (err: unknown) => console.error('❌ URDF 로드 실패:', err)
    );

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      if (controlsRef.current) controlsRef.current.dispose();
      renderer.dispose();
      if (mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const robot = robotRef.current;
    if (!robot?.joints) return;
    const motorValue = openRatio * MOTOR_MAX;
    if (robot.joints['Motor_joint']) {
      robot.joints['Motor_joint'].setJointValue(motorValue);
    }
    applyMimicJoints(robot.joints, motorValue);
  }, [openRatio]);

  const handleReset = () => {
    if (controlsRef.current) controlsRef.current.reset();
    setIsRotating(false);
  };

  const handleToggleRotation = () => {
    setIsRotating(prev => {
      const next = !prev;
      if (!next && controlsRef.current) controlsRef.current.autoRotate = false;
      return next;
    });
  };

  const statusLabel = eStop ? 'E-Stop' : activated ? 'Active' : connected ? 'Online' : 'Offline';
  const statusBg    = eStop ? '#FFEBEE' : activated ? '#E8F5E9' : connected ? '#E3F2FD' : '#F0F4F8';
  const statusTxt   = eStop ? '#C62828' : activated ? '#2E7D32' : connected ? '#1565C0' : '#90A4AE';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>

      {/* 상태 칩 + 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          padding: '3px 8px', borderRadius: 10,
          backgroundColor: statusBg,
          fontSize: 10, fontWeight: 700, color: statusTxt,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: statusColor, display: 'inline-block',
            boxShadow: objectDetected ? `0 0 6px ${statusColor}` : 'none',
          }} />
          {statusLabel}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={handleToggleRotation}
            title={isRotating ? '회전 정지' : '자동 회전'}
            style={{
              width: 26, height: 26,
              border: isRotating ? '1.5px solid #1976D2' : '1.5px solid #CFD8DC',
              borderRadius: 6,
              backgroundColor: isRotating ? '#E3F2FD' : '#F8FAFB',
              color: isRotating ? '#1976D2' : '#78909C',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', padding: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6" />
              <path d="M2.5 12a9.5 9.5 0 0 1 16.5-6.5L21.5 8" />
              <path d="M2.5 22v-6h6" />
              <path d="M21.5 12a9.5 9.5 0 0 1-16.5 6.5L2.5 16" />
            </svg>
          </button>

          <button
            onClick={handleReset}
            title="카메라 원점 복귀"
            style={{
              width: 26, height: 26,
              border: '1.5px solid #CFD8DC',
              borderRadius: 6,
              backgroundColor: '#F8FAFB',
              color: '#78909C',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', padding: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
              <path d="M9 21V12h6v9" />
            </svg>
          </button>
        </div>
      </div>

      {/* 3D 뷰어 */}
      <div
        ref={mountRef}
        style={{
          flex: 1, width: '100%', minHeight: 0,
          borderRadius: 8, overflow: 'hidden',
          position: 'relative', background: 'transparent', cursor: 'grab',
        }}
      >
        {isMoving && (
          <div style={{
            position: 'absolute', top: 4, right: 6,
            fontSize: 10, color: '#1976D2', fontWeight: 'bold',
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 2,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              backgroundColor: '#1976D2', display: 'inline-block',
            }} />
            Moving
          </div>
        )}
      </div>
    </div>
  );
};

export default GripperViewer;