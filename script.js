const SIGNALING_URL = "wss://inai-col3.fishrungames.com/signaling/";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const localPlaceholder = document.getElementById("localPlaceholder");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const localState = document.getElementById("localState");
const remoteState = document.getElementById("remoteState");
const peerPlaceholderText = document.getElementById("peerPlaceholderText");
const connectBtn = document.getElementById("connectBtn");
const hangupBtn = document.getElementById("hangupBtn");
const cameraBtn = document.getElementById("cameraBtn");
const micBtn = document.getElementById("micBtn");

let ws = null, pc = null, stream = null;
let connectedToPeer = false, makingOffer = false, ignoreOffer = false;
const polite = Math.random() < 0.5;
let cameraEnabled = false, micEnabled = false;
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function setStatus(text, state="") {
  statusText.textContent = text;
  statusDot.className = "dot" + (state ? " " + state : "");
}
function sendSignal(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function showLocal() { localPlaceholder.style.display = stream && stream.getVideoTracks().some(t=>t.enabled) ? "none" : "flex"; }
function showRemote() { remotePlaceholder.style.display = remoteVideo.srcObject ? "none" : "flex"; }
function setButtons(active) { connectBtn.disabled = active; hangupBtn.disabled = !active; }

async function getMedia() {
  if (stream) return stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    cameraEnabled = stream.getVideoTracks().length > 0;
    micEnabled = stream.getAudioTracks().length > 0;
    stream.getVideoTracks().forEach(t=>t.enabled=cameraEnabled);
    stream.getAudioTracks().forEach(t=>t.enabled=micEnabled);
    cameraBtn.classList.toggle("off", !cameraEnabled);
    micBtn.classList.toggle("off", !micEnabled);
    localState.textContent = cameraEnabled ? "Камера включена" : "Камера выключена";
    showLocal();
    return stream;
  } catch (err) {
    throw new Error("Не удалось получить камеру/микрофон: " + err.message);
  }
}
function createPeer() {
  pc = new RTCPeerConnection(rtcConfig);
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.ontrack = event => {
    if (event.streams && event.streams[0]) remoteVideo.srcObject = event.streams[0];
    else {
      if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
      remoteVideo.srcObject.addTrack(event.track);
    }
    showRemote();
    remoteState.textContent = "Видео получено";
    setStatus("Собеседник подключён", "active");
  };
  pc.onicecandidate = event => { if (event.candidate) sendSignal({ type: "ice-candidate", candidate: event.candidate }); };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      setStatus("Звонок активен", "active");
      remoteState.textContent = "Соединение установлено";
    } else if (["disconnected","failed"].includes(pc.connectionState)) {
      setStatus("Соединение нестабильно", "warn");
    }
  };
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      sendSignal({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (err) { console.error("Negotiation error", err); }
    finally { makingOffer = false; }
  };
}
async function handleSignal(msg) {
  if (!pc) return;
  try {
    if (msg.type === "offer") {
      const offerCollision = makingOffer || pc.signalingState !== "stable";
      ignoreOffer = !polite && offerCollision;
      if (ignoreOffer) return;
      if (offerCollision && polite && pc.signalingState !== "stable") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      await pc.setLocalDescription();
      sendSignal({ type: "answer", sdp: pc.localDescription.sdp });
    } else if (msg.type === "answer") {
      if (pc.signalingState === "have-local-offer") await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    } else if (msg.type === "ice-candidate") {
      const candidate = msg.candidate || msg.iceCandidate;
      if (candidate) await pc.addIceCandidate(candidate);
    } else if (msg.type === "peer-left") {
      resetPeer("Собеседник отключился");
    }
  } catch (err) { console.error("Signal handling error", err); }
}
async function connect() {
  connectBtn.disabled = true;
  setStatus("Запрашиваем камеру…", "warn");
  try {
    await getMedia();
    setStatus("Подключаемся к серверу…", "warn");
    ws = new WebSocket(SIGNALING_URL);
    ws.onopen = () => {
      setStatus("Ожидание собеседника", "active");
      remoteState.textContent = "Ожидание подключения";
      setButtons(true);
      createPeer();
    };
    ws.onmessage = async event => {
      let data;
      try { data = JSON.parse(event.data); } catch { console.warn("Non-JSON signaling message", event.data); return; }
      await handleSignal(data);
    };
    ws.onerror = () => setStatus("Ошибка WebSocket", "warn");
    ws.onclose = () => {
      if (pc) resetPeer("Сервер отключил соединение");
      else setStatus("Не подключено");
    };
  } catch (err) {
    alert(err.message);
    setStatus("Не подключено");
    connectBtn.disabled = false;
  }
}
function resetPeer(message="Звонок завершён") {
  connectedToPeer = false;
  if (pc) { pc.ontrack=null; pc.onicecandidate=null; pc.close(); pc=null; }
  remoteVideo.srcObject=null;
  remoteState.textContent="Пока не подключён";
  peerPlaceholderText.textContent=message;
  showRemote();
  if (ws && ws.readyState !== WebSocket.CLOSED) { const old=ws; ws=null; old.close(); }
  setStatus(message);
  setButtons(false);
}
function hangup() {
  resetPeer("Звонок завершён");
  if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; localVideo.srcObject=null; }
  cameraEnabled=false; micEnabled=false;
  localState.textContent="Камера выключена";
  showLocal();
  cameraBtn.classList.remove("off"); micBtn.classList.remove("off");
}
cameraBtn.addEventListener("click", async()=>{
  if (!stream) {
    try { await getMedia(); } catch(err) { alert(err.message); return; }
  }
  const tracks=stream.getVideoTracks();
  if (!tracks.length) return;
  cameraEnabled=!cameraEnabled; tracks.forEach(t=>t.enabled=cameraEnabled);
  cameraBtn.classList.toggle("off",!cameraEnabled);
  localState.textContent=cameraEnabled?"Камера включена":"Камера выключена";
  showLocal();
});
micBtn.addEventListener("click", async()=>{
  if (!stream) {
    try { await getMedia(); } catch(err) { alert(err.message); return; }
  }
  const tracks=stream.getAudioTracks();
  if (!tracks.length) return;
  micEnabled=!micEnabled; tracks.forEach(t=>t.enabled=micEnabled);
  micBtn.classList.toggle("off",!micEnabled);
  micBtn.querySelector("span:last-child").textContent=micEnabled?"Микрофон":"Микрофон выключен";
});
connectBtn.addEventListener("click", connect);
hangupBtn.addEventListener("click", hangup);
window.addEventListener("beforeunload",()=>{
  if (ws) ws.close();
  if (pc) pc.close();
  if (stream) stream.getTracks().forEach(t=>t.stop());
});
