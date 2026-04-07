// Vanilla build: rely on global UMD from CDN script
const ZoomVideo =
  (window.WebVideoSDK && (window.WebVideoSDK.default || window.WebVideoSDK)) ||
  window.ZoomVideo;

function generateHostName() {
  return `Host-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/* ─── State ─── */
let client, stream;
let isAudioMuted = true; // ✅ mic OFF by default
let isVideoOn = false; // ✅ camera OFF by default
let isAudioStarted = false;
let isSharing = false;
let activeShareUserId = null;
let recordingClient = null;
let isRecording = false;
let isRecordingPaused = false;
let ltClient = null;
let isTranscribing = false;
let isLtChanging = false;
let raisedHands = [];
let isHandRaisedSelf = false;
let cmdClient = null;
const handNameMap = {};
let currentVirtualBg = "none";
let resolvedVirtualBgUrl = null;
let localVideoTrack = null;
let pendingVirtualBg = null;
let isVbSupported = false;
let selfVideoEl = null;
let pipWindow = null;
let pipSourceEl = null;
let pipPlaceholder = null;
const CHAT_CLOSED = 0;
const CHAT_NARROW = 1;
const CHAT_WIDE = 2;
let chatState = CHAT_CLOSED;
let isToggleProcessing = false;
let isJoined = false;
let timerInterval = null;
const sessionName = "TestOne";
const userName = generateHostName();
const role = 1;
const userIdentity = "host_fc43d7de-54e0-4e0d-96b9-6b6b7e77ba34";
const userUuid = "019d2400-0b83-73b6-a2fb-fe33cee9098d";
const serverIdentityPref = "host";
const serverUserId = "019d2400-0b83-73b6-a2fb-fe33cee9098d";
const sessionHostName = "Test User";
const sessionCoHostNames = ["Smit", "Ravi"];

const REAL_HOST_ID = "019d2400-0b83-73b6-a2fb-fe33cee9098d";
const coHosts = [
  "019d2905-a5e6-711f-a23b-f1bf8afe24d2",
  "019d24af-443d-71b5-8a2e-ac1868749a6d",
];

const MAX_VISIBLE_SLOTS = 4;

/* ─── Timer ─── */
function startTimer() {
  const t0 = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    document.getElementById("timer-label").textContent = `${mm}:${ss} elapsed`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  document.getElementById("timer-label").textContent = "00:00 elapsed";
}

/* ─── Grid layout ─── */
function updateGridLayout() {
  const grid = document.getElementById("video-grid");
  if (!grid) return;
  const n = grid.querySelectorAll(".video-slot").length;
  grid.classList.remove("layout-2", "layout-3", "layout-4");
  if (n === 2) grid.classList.add("layout-2");
  else if (n === 3) grid.classList.add("layout-3");
  else if (n >= 4) grid.classList.add("layout-4");
  document.getElementById("empty-ph").classList.toggle("visible", n === 0);
}

/* ─── Re-order grid: host first, then managers, then others ─── */
function reorderGrid() {
  const grid = document.getElementById("video-grid");
  if (!grid) return;
  const slots = [...grid.querySelectorAll(".video-slot")];
  slots.sort((a, b) => {
    const rank = (el) => {
      if (el.classList.contains("host-slot")) return 0;
      if (el.classList.contains("manager-slot")) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });
  // Re-append in sorted order — moves existing DOM nodes, no clone needed
  slots.forEach((slot) => grid.appendChild(slot));
}

function getIdentityPrefix(userPayload, userId) {
  if (!userPayload) return "";

  // ✅ Primary: read user_identity directly from Zoom user object
  const identity =
    userPayload.userIdentity || // Zoom SDK field name
    userPayload.user_identity ||
    userPayload.identity ||
    "";

  if (typeof identity === "string" && identity.includes("_")) {
    return identity.split("_")[0].toLowerCase(); // "host", "cohost", "participant"
  }

  // ✅ Fallback: match against self using userName (not userId)
  // Zoom's userName is what you passed to client.join() as the 3rd argument
  const zoomName = userPayload.displayName || userPayload.userName || "";
  if (zoomName && zoomName === userName) {
    // userName is your blade var
    return serverIdentityPref || "";
  }

  return "";
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getRoleType(userPayload) {
  if (!userPayload) return null;
  const candidates = [
    userPayload.role_type,
    userPayload.roleType,
    userPayload.role,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "")
      continue;
    const numeric = Number(candidate);
    if (!Number.isNaN(numeric)) return numeric;
  }
  return null;
}

function getParticipantKind(userPayload, userId) {
  const prefix = getIdentityPrefix(userPayload, userId);
  if (prefix === "host") return "host";
  if (prefix === "cohost") return "cohost";

  const roleType = getRoleType(userPayload);
  const displayName = normalizeName(dname(userPayload));
  const isSelf = serverUserId && String(serverUserId) === String(userId);

  if (isSelf && serverIdentityPref === "host") return "host";
  if (isSelf && serverIdentityPref === "cohost") return "cohost";
  if (displayName && displayName === normalizeName(sessionHostName))
    return "host";
  if (
    displayName &&
    sessionCoHostNames.map(normalizeName).includes(displayName)
  )
    return "cohost";
  if (roleType === 1) return "cohost";
  if (roleType === 0) return "audience";
  return "audience";
}

function shouldRenderUser(userPayload, userId) {
  const kind = getParticipantKind(userPayload, userId);

  // ✅ Self detection via userName match, not userId
  const zoomName = userPayload?.displayName || userPayload?.userName || "";
  const isSelf = zoomName === userName; // userName = blade {{ $uid }}

  if (isSelf) return role === 1; // only show self if host
  return kind === "host" || kind === "cohost";
}

function getIDFromName(displayName) {
  if (!displayName.includes("|")) {
    return "";
  }

  return displayName.split("|")[1];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncHost() {
  try {
    const currentUser = client.getCurrentUserInfo();
    // Only current host can transfer
    if (!currentUser.isHost) return;

    // 🔥 wait for SDK to stabilize after join
    await delay(800);

    const users = client.getAllUser();

    const target = users.find((u) => {
      let getUserID = getIDFromName(String(u.displayName));
      return getUserID === REAL_HOST_ID;
    });

    if (!target) return;

    // Already host → skip
    if (target.userId === currentUser.userId) return;

    // ✅ Step 1: assign managers FIRST
    await syncManagers();

    // 🔥 small delay before host transfer
    await delay(500);

    console.log(`1204 Transferring host to ${target.displayName}`);

    try {
      // ✅ Step 2: assign Host
      await client.makeHost(target.userId);
    } catch (error) {
      console.log("1210 Host transfer retry...", error);
    }
  } catch (error) {
    console.error("Error in syncHost:", error);
  }
}

async function syncManagers() {
  try {
    const currentUser = client.getCurrentUserInfo();

    // ❌ Only host can assign roles
    if (!currentUser.isHost) return;

    const users = client.getAllUser();

    for (const user of users) {
      // Skip self (optional but cleaner)
      if (user.userId === currentUser.userId) continue;

      // Check if user should be manager
      let getUserID = getIDFromName(String(user.displayName));
      if (coHosts.includes(getUserID)) {
        // Avoid duplicate calls
        if (!user.isManager && !user.isHost) {
          console.log(`Assigning manager to: ${user.displayName}`);
          await client.makeManager(user.userId);
          await delay(300); // 🔥 important (SDK sync time)
        } else {
          // console.log(`already manager ${user.displayName}`); (suppressed)
        }
      }
    }
  } catch (error) {
    console.error("Error in syncManagers:", error);
  }
}

async function makeHostForceFully() {
  try {
    const currentUser = client.getCurrentUserInfo();
    // Only current host can transfer
    if (!currentUser.isHost) return;

    if (coHosts.length == 0) return;

    let getUserID = getIDFromName(String(currentUser.displayName));

    if (coHosts.includes(getUserID)) return;

    // 🔥 wait for SDK to stabilize after join
    await delay(800);

    console.log("VA or Moderator is host.");

    // ✅ Step 1: assign managers FIRST
    await syncManagers();

    const users = client.getAllUser();

    const target = users.find((u) => {
      let getUserID = getIDFromName(String(u.displayName));
      return getUserID === coHosts[0];
    });

    // 🔥 small delay before host transfer
    await delay(500);

    console.log(`1204 Transferring host to ${target.displayName}`);

    try {
      // ✅ Step 2: assign Host
      await client.makeHost(target.userId);
    } catch (error) {
      console.log("1309 Host transfer retry...", error);
    }
  } catch (error) {
    console.error("Error in syncHost:", error);
  }
}

async function syncVisibleUsers() {
  if (!client) return;

  const me = client.getCurrentUserInfo?.();
  const myId = me?.userId;
  const users = client
    .getAllUser()
    .filter((u) => shouldRenderUser(u, u.userId))
    .sort((a, b) => userRank(a) - userRank(b));

  const visibleIds = new Set(users.map((u) => String(u.userId)));
  const currentSlots = [
    ...document.querySelectorAll("#video-grid .video-slot"),
  ];

  // Rebuild raised-hand order from visible users (preserve arrival order where possible)
  const raisedSet = new Set(
    users.filter((u) => getHandRaised(u)).map((u) => String(u.userId)),
  );
  const newHands = raisedHands.filter((id) => raisedSet.has(id));
  for (const u of users) {
    const id = String(u.userId);
    if (raisedSet.has(id) && !newHands.includes(id)) newHands.push(id);
  }
  raisedHands = newHands;

  for (const slot of currentSlots) {
    const userId = String(slot.id.replace("user-", ""));
    if (!visibleIds.has(userId)) {
      await removeVideoSlot(userId);
    }
  }

  for (const user of users) {
    if (user.userId === myId) {
      const selfPayload = {
        ...me,
        ...user,
      };
      if (!document.getElementById("user-" + myId)) {
        await renderAudioOnlySlot(myId, selfPayload);
      } else {
        setVideoOff(myId, dname(selfPayload), !isVideoOn);
      }
      setHandRaised(myId, getHandRaised(selfPayload));

      if (isVideoOn) {
        await renderVideo(myId, selfPayload);
      }
      continue;
    }

    if (user.bVideoOn) {
      await renderVideo(user.userId, user);
    } else {
      if (!document.getElementById("user-" + user.userId)) {
        await renderAudioOnlySlot(user.userId, user);
      }
      setVideoOff(user.userId, dname(user), true);
    }
    setHandRaised(user.userId, getHandRaised(user));
  }

  reorderGrid();
  updateGridLayout();
  updateHandListUI();
}

/* ─── Priority rank for sorting user arrays ─── */
function userRank(u) {
  const kind = getParticipantKind(u, u?.userId);
  if (kind === "host") return 0;
  if (kind === "cohost") return 1;
  return 2;
}

/* ─── Helper: get display name ─── */
function dname(u) {
  return (
    u?.displayName ||
    u?.userName ||
    u?.user_identity ||
    `User ${u?.userId || "?"}`
  );
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

/* ─── Build slot shell (placeholder + mute badge + name badge) ─── */
function buildSlot(userId, userPayload) {
  const dn = dname(userPayload);
  const slot = document.createElement("div");
  slot.id = "user-" + userId;
  slot.className = "video-slot";

  const me = client?.getCurrentUserInfo?.();
  const isSelf = me?.userId === userId;
  if (isSelf) slot.classList.add("self-view");
  const participantKind = getParticipantKind(userPayload, userId);
  slot.dataset.identityPrefix = participantKind || "";
  if (participantKind === "host") slot.classList.add("host-slot");
  else if (participantKind === "cohost") slot.classList.add("manager-slot");

  // Video-off placeholder
  const ph = document.createElement("div");
  ph.className = "video-placeholder";
  const av = document.createElement("div");
  av.className = "ph-avatar";
  av.textContent = initials(dn);
  ph.appendChild(av);
  slot.appendChild(ph);

  // Mute badge
  const mb = document.createElement("div");
  mb.className = "mute-badge";
  mb.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
            <path d="M17 16.95A7 7 0 0 1 5 12v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
        </svg>`;
  slot.appendChild(mb);

  // Name badge
  const badge = document.createElement("div");
  badge.className = "video-badge";
  badge.textContent = dn + (isSelf ? " (You)" : "");
  slot.appendChild(badge);

  // Raised hand badge (top-left)
  const hb = document.createElement("div");
  hb.className = "hand-badge";
  hb.innerHTML = "✋";
  hb.style.display = "none";
  slot.appendChild(hb);

  // Initial muted state
  // In buildSlot(), replace the initMuted line with:
  const initMuted =
    userPayload?.muted === true ||
    (Object.prototype.hasOwnProperty.call(userPayload ?? {}, "bAudioOn")
      ? !userPayload.bAudioOn
      : true);
  if (initMuted) slot.classList.add("is-muted");

  return slot;
}

/* ─── Set video off/on for existing slot ─── */
function setVideoOff(userId, dn, isOff) {
  const slot = document.getElementById("user-" + userId);
  if (!slot) return;
  slot.classList.toggle("video-off", isOff);
  if (dn) {
    const av = slot.querySelector(".ph-avatar");
    if (av) av.textContent = initials(dn);
  }
}

/* ─── Set muted state for existing slot ─── */
function setMuted(userId, isMuted) {
  const slot = document.getElementById("user-" + userId);
  if (slot) slot.classList.toggle("is-muted", isMuted);
}

function setHandRaised(userId, raised) {
  const slot = document.getElementById("user-" + userId);
  if (!slot) return;
  const hb = slot.querySelector(".hand-badge");
  if (hb) hb.style.display = raised ? "" : "none";
  slot.classList.toggle("hand-up", raised);
}

function getHandRaised(u) {
  return Boolean(
    u?.isHandRaised ??
    u?.bHandRaised ??
    u?.handRaised ??
    u?.raisedHand ??
    u?.isHandRaise,
  );
}

function handleHandChange(userId, raised) {
  const idStr = String(userId);
  if (handNameMap[idStr]) {
    // keep stored name
  }
  const idx = raisedHands.indexOf(idStr);
  if (raised && idx === -1) {
    raisedHands.push(idStr);
  } else if (!raised && idx !== -1) {
    raisedHands.splice(idx, 1);
  }
  setHandRaised(userId, raised);
  updateHandListUI();
}

function updateHandListUI() {
  const el = document.getElementById("hand-list");
  if (!el) return;
  if (!raisedHands.length) {
    el.textContent = "";
    el.style.display = "none";
    return;
  }
  const firstId = raisedHands[0];
  const firstUser =
    client?.getUser?.(firstId) ||
    client?.getAllUser?.().find((u) => String(u.userId) === firstId);
  const name = dname(firstUser) || handNameMap[firstId] || `User ${firstId}`;
  const rest = raisedHands.length - 1;
  el.textContent = rest > 0 ? `${name} +${rest}` : name;
  el.style.display = "inline-flex";
}

async function toggleRaiseHand() {
  if (!client) return;
  const me = client.getCurrentUserInfo?.();
  if (!me) return;
  const newState = !isHandRaisedSelf;
  try {
    await client.raiseHand?.(newState);
    isHandRaisedSelf = newState;
    handleHandChange(me.userId, newState);
  } catch (err) {
    console.error("toggle raise hand failed", err);
  }
}

function handleCommandReceived({ command, senderId, senderName }) {
  try {
    const data = JSON.parse(command);
    if (data?.type === "hand") {
      const uid = data.userId || senderId;
      const raised = Boolean(data.raised);
      if (data.userName) handNameMap[String(uid)] = data.userName;
      handleHandChange(uid, raised);
    }
  } catch (err) {
    console.error("Failed to parse command", err);
  }
}

/* ─── Remove slot ─── */
async function removeVideoSlot(userId) {
  const slot = document.getElementById("user-" + userId);
  if (!slot) return;
  try {
    if (stream) await stream.detachVideo(userId);
  } catch (e) {}
  slot.remove();
  updateGridLayout();
}

/* ─── Render slot with video ─── */
/* ─── Render slot with video ─── */
async function renderVideo(userId, userPayload = {}) {
  const grid = document.getElementById("video-grid");
  if (!grid) return;

  let slot = document.getElementById("user-" + userId);
  if (!slot) {
    if (grid.querySelectorAll(".video-slot").length >= MAX_VISIBLE_SLOTS)
      return;
    slot = buildSlot(userId, userPayload);
    slot.classList.add("loading");
    const vpc = document.createElement("video-player-container");
    slot.appendChild(vpc);
    grid.appendChild(slot);
    updateGridLayout();
    reorderGrid(); // ✅ keep order after each add
  }

  slot.classList.remove("video-off");
  setHandRaised(userId, getHandRaised(userPayload));

  let vpc = slot.querySelector("video-player-container");
  if (!vpc) {
    vpc = document.createElement("video-player-container");
    slot.appendChild(vpc);
  }

  // ✅ Only attach if not already rendering
  if (!vpc.querySelector("video-player")) {
    const vp = document.createElement("video-player");
    vpc.appendChild(vp);
    try {
      await stream.attachVideo(userId, 3, vp);
      slot.classList.remove("loading");
    } catch (err) {
      console.error("attachVideo failed:", userId, err);
    }
  } else {
    slot.classList.remove("loading");
  }
}

/* ─── Render audio-only slot (video off) ─── */
async function renderAudioOnlySlot(userId, userPayload = {}) {
  if (document.getElementById("user-" + userId)) return;
  const grid = document.getElementById("video-grid");
  if (!grid || grid.querySelectorAll(".video-slot").length >= MAX_VISIBLE_SLOTS)
    return;

  const slot = buildSlot(userId, userPayload);
  slot.classList.add("video-off");
  const vpc = document.createElement("video-player-container");
  slot.appendChild(vpc);
  grid.appendChild(slot);
  setHandRaised(userId, getHandRaised(userPayload));
  updateGridLayout();
  reorderGrid(); // ✅ keep order after each add
  const ph = document.getElementById("empty-ph");
  if (ph) ph.classList.remove("visible");
}

/* ─── Join ─── */
async function startSession() {
  if (!ZoomVideo) {
    alert(
      "Zoom Video SDK not loaded. Ensure https://source.zoom.us/videosdk/zoom-video-2.3.14.min.js is included before src/main.js.",
    );
    return;
  }
  if (isToggleProcessing) return;
  if (isJoined) {
    await leaveSession();
    return;
  }
  isToggleProcessing = true;
  document.getElementById("start-btn").textContent = "Joining…";

  try {
    const token =
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhcHBfa2V5IjoiaWpVTnpkNHZSQ1ZHeXFNV1ZXbkFZWlA1WW15NWQ2aFpOTkV5IiwidHBjIjoiVGVzdE9uZSIsInJvbGVfdHlwZSI6MCwidXNlcl9pZGVudGl0eSI6IkZsdXR0ZXIiLCJpYXQiOjE3NzUxMzIyNjUsImV4cCI6MTc3NTEzOTQ2NX0.ffTmmID9u9uz5dilGwUXB-rBk-ctEQAzZOT2uiJqn3Q";

    client = ZoomVideo.createClient();

    // Pre-flight permissions
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {}

    await client.init("en-US", "Global", {
      patchJsMedia: true,
      dependentAssets: window.location.origin + "/zoom-lib/",
      stayAwake: true,
      enforceVirtualBackground: true,
    });

    let _userNameId = userName + "|" + userUuid;

    await client.join(sessionName, token, _userNameId);

    console.log("userIdentity -> ", userIdentity);
    console.log("userUuid -> ", userUuid);
    isJoined = true;

    const allUsers = client.getAllUser();

    // Show meeting UI
    document.getElementById("join-container").style.display = "none";
    document.getElementById("webinar-header").style.display = "block";
    document.getElementById("main-container").style.display = "flex";
    document.getElementById("controls").style.display = "flex";
    updateGridLayout();
    startTimer();

    // ✅ Single assignment
    stream = client.getMediaStream();
    isVbSupported =
      typeof stream.isSupportVirtualBackground === "function" &&
      stream.isSupportVirtualBackground();
    updateVbUi(isVbSupported);

    // ✅ Start audio muted — once only
    // Replace the startAudio block with this:
    try {
      await stream.startAudio({
        mute: true,
      });
      isAudioStarted = true;
      isAudioMuted = true;
    } catch (e) {
      // Mobile browsers block auto-start without gesture — that's fine
      // Audio will be started on first toggleAudio() call instead
      console.warn("Audio auto-start blocked (mobile):", e.message || e);
      isAudioStarted = false;
      isAudioMuted = true;
    }

    // ✅ Camera stays off
    isVideoOn = false;

    // ✅ Recording client
    recordingClient = client.getRecordingClient?.() || null;
    updateRecordingUi(recordingClient?.canStartRecording?.());

    // ✅ Live transcription client
    ltClient = client.getLiveTranscriptionClient?.() || null;
    updateLtUi(ltClient !== null);

    // ✅ Render ALL users including self, sorted by rank
    const myId = client.getCurrentUserInfo().userId;
    const myInfo = client.getCurrentUserInfo();
    if (serverIdentityPref && serverUserId) {
      myInfo.user_identity = `${serverIdentityPref}_${serverUserId}`;
    }
    await syncVisibleUsers();

    const sessionInfo = client.getSessionInfo();
    const sessionId = sessionInfo.sessionId;

    console.log("Session ID:", sessionId);

    // Host-only controls
    // Replace the host-only block with this:
    if (role === 1) {
      // Host gets both mic and camera
      document.getElementById("audio-btn").style.display = "flex";
      document.getElementById("video-btn").style.display = "flex";
      document.getElementById("share-btn").style.display = "flex";
      document.getElementById("record-btn").style.display = "flex";
      document.getElementById("lt-btn").style.display = "flex";
      document.getElementById("lt-translate").style.display = "inline-block";
      document.getElementById("hand-btn").style.display = "flex";
    } else {
      // Audience gets mic only (no camera in webinar)
      document.getElementById("audio-btn").style.display = "flex";
      document.getElementById("video-btn").style.display = "none";
      document.getElementById("share-btn").style.display = "none";
      document.getElementById("record-btn").style.display = "none";
      document.getElementById("lt-btn").style.display = "none";
      document.getElementById("lt-translate").style.display = "none";
      document.getElementById("hand-btn").style.display = "flex";
    }

    // Self hand init
    isHandRaisedSelf = false;

    // Command client (for cross-platform signals like hand raise)
    cmdClient = client.getCommandClient?.() || null;

    client.on(`command-channel-message`, (payload) => {
      console.log(`command-channel-message Command from $payload}`);
    });

    // New user joins
    client.on("user-added", async (payload) => {
      console.log("User Added");
      // await enforceHostRoles();
      await syncHost();
      await syncVisibleUsers();
    });

    client.on(`caption-status`, (payload) => {
      const { sessionLanguage } = payload;
      if (sessionLanguage) {
        console.log(`Session language has been changed to ${sessionLanguage}`);
      }
    });
    client.on(`caption-message`, (payload) => {
      console.log(payload);
      console.log(`${payload.displayName} said: ${payload.text}`);
      console.log(
        `${payload.displayName} said: ${payload.text}, translated to ${payload.language}`,
      );
    });

    client.on(`caption-message`, (payload) => {
      console.log(payload);
    });
    // User state changes
    client.on("user-updated", async (payload) => {
      await syncManagers();
      for (const u of payload) {
        if (!shouldRenderUser(u, u.userId)) {
          await removeVideoSlot(u.userId);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(u, "bVideoOn")) {
          if (u.bVideoOn) {
            const existing = document.getElementById("user-" + u.userId);
            if (existing) {
              setVideoOff(u.userId, null, false);
              let vpc = existing.querySelector("video-player-container");
              if (!vpc) {
                vpc = document.createElement("video-player-container");
                existing.appendChild(vpc);
              }
              vpc.innerHTML = "";
              const vp = document.createElement("video-player");
              vpc.appendChild(vp);
              try {
                await stream.attachVideo(u.userId, 2, vp);
              } catch (e) {
                console.error(e);
              }
            } else {
              await renderVideo(u.userId, u);
            }
          } else {
            setVideoOff(u.userId, dname(u), true);
            try {
              await stream.detachVideo(u.userId);
            } catch (e) {}
          }
        }
        if (Object.prototype.hasOwnProperty.call(u, "muted")) {
          setMuted(u.userId, u.muted);
        }
        if (Object.prototype.hasOwnProperty.call(u, "bAudioOn")) {
          setMuted(u.userId, !u.bAudioOn);
        }
        handleHandChange(u.userId, getHandRaised(u));
      }
      await syncVisibleUsers();
    });

    // User leaves
    client.on("user-removed", async (payload) => {
      for (const u of payload) {
        await removeVideoSlot(u.userId);
        handleHandChange(u.userId, false);
      }
      await syncVisibleUsers();
    });

    client.on("active-share-change", ({ state, userId }) => {
      if (state === "Start") handleShareStart(userId);
      else if (state === "Stop") handleShareStop(userId);
    });

    client.on("share-user-added", (payload) => {
      const userId = payload?.userId ?? payload?.[0]?.userId ?? payload;
      if (userId !== undefined) handleShareStart(userId);
    });

    client.on("share-user-removed", (payload) => {
      const userId = payload?.userId ?? payload?.[0]?.userId ?? payload;
      if (userId !== undefined) handleShareStop(userId);
    });

    console.log("Joined successfully!");
  } catch (err) {
    console.error("Join failed:", err);
    alert("Failed to join. See console for details.");
    document.getElementById("start-btn").textContent = "▶ Join Now";
  } finally {
    isToggleProcessing = false;
  }
}

/* ─── Audio toggle ─── */
async function toggleAudio() {
  if (isToggleProcessing) return;
  if (!stream) return;
  isToggleProcessing = true;
  try {
    if (isAudioMuted) {
      // Unmute path
      if (!isAudioStarted) {
        // Mobile: first time, start + unmute in one call
        try {
          await stream.startAudio({
            mute: false,
          });
          isAudioStarted = true;
        } catch (e) {
          console.error("startAudio failed:", e);
          isToggleProcessing = false;
          return;
        }
      } else {
        await stream.unmuteAudio();
      }
      isAudioMuted = false;
      document.getElementById("mic-on").style.display = "";
      document.getElementById("mic-off").style.display = "none";
      document.getElementById("audio-btn").classList.remove("muted");
    } else {
      // Mute path
      await stream.muteAudio();
      isAudioMuted = true;
      document.getElementById("mic-on").style.display = "none";
      document.getElementById("mic-off").style.display = "";
      document.getElementById("audio-btn").classList.add("muted");
    }
    if (client) setMuted(client.getCurrentUserInfo().userId, isAudioMuted);
  } catch (e) {
    console.error("toggleAudio error:", e);
  } finally {
    isToggleProcessing = false;
  }
}

/* ─── Video toggle ─── */
async function toggleVideo() {
  if (!stream || isToggleProcessing || !client) return;
  isToggleProcessing = true;
  const myId = client.getCurrentUserInfo().userId;
  const myInfo = client.getCurrentUserInfo();
  try {
    if (isVideoOn) {
      // Stop video
      await stream.stopVideo();
      isVideoOn = false;
      document.getElementById("vid-on").style.display = "none";
      document.getElementById("vid-off").style.display = "";
      document.getElementById("video-btn").classList.remove("active");
      setVideoOff(myId, dname(myInfo), true);
      try {
        await stream.detachVideo(myId);
      } catch (e) {}
    } else {
      // Start video
      await stream.startVideo({
        hd: true,
      });
      isVideoOn = true;
      document.getElementById("vid-on").style.display = "";
      document.getElementById("vid-off").style.display = "none";
      document.getElementById("video-btn").classList.add("active");
      setVideoOff(myId, null, false);

      // Ensure my slot exists in grid
      if (!document.getElementById("user-" + myId)) {
        await renderAudioOnlySlot(myId, myInfo);
      }
      const slot = document.getElementById("user-" + myId);
      if (slot) {
        let vpc = slot.querySelector("video-player-container");
        if (!vpc) {
          vpc = document.createElement("video-player-container");
          slot.appendChild(vpc);
        }
        // ✅ Clear stale video-player, attach fresh one (fixes 2nd-toggle bug)
        vpc.innerHTML = "";
        const vp = document.createElement("video-player");
        vpc.appendChild(vp);
        try {
          await stream.attachVideo(myId, 3, vp);
        } catch (e) {
          console.error(e);
        }
      }
    }
  } finally {
    isToggleProcessing = false;
  }
}

/* ─── Screen share start ─── */
function getShareElement(forSelf) {
  // WebCodecs self-share prefers video; remote share view prefers canvas
  if (forSelf) return document.getElementById("share-video");
  return document.getElementById("share-canvas");
}

function showShareContainer(label) {
  const wrap = document.getElementById("share-container");
  const owner = document.getElementById("share-owner");
  if (!wrap) return;
  if (owner) owner.textContent = label || "Screen share";
  wrap.classList.remove("share-hidden");
  const ph = document.getElementById("empty-ph");
  if (ph) ph.classList.remove("visible");
}

function hideShareContainer() {
  const wrap = document.getElementById("share-container");
  const vid = getShareElement(true);
  if (vid && vid.tagName === "VIDEO") {
    try {
      vid.pause();
      vid.srcObject = null;
      vid.removeAttribute("src");
      vid.load();
    } catch (e) {}
  }
  const canvas = getShareElement(false);
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (wrap) wrap.classList.add("share-hidden");
}

function updateShareButton(on) {
  const btn = document.getElementById("share-btn");
  const onIcon = document.getElementById("share-on");
  const offIcon = document.getElementById("share-off");
  if (btn) btn.classList.toggle("active", !!on);
  if (onIcon) onIcon.style.display = on ? "" : "none";
  if (offIcon) offIcon.style.display = on ? "none" : "";
}

function createVideoElement() {
  const vid = document.createElement("video");
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = true;
  vid.setAttribute("muted", "muted");
  vid.style.width = "100%";
  vid.style.height = "100%";
  return vid;
}

async function startLocalShare() {
  const el = getShareElement(true);
  if (!stream || !el) return;
  try {
    await stream.startShareScreen(el, {
      videoProfile: "720p",
      captureAudio: false,
    });
    isSharing = true;
    activeShareUserId = client?.getCurrentUserInfo?.().userId || null;
    showShareContainer("You are sharing");
    updateShareButton(true);
  } catch (e) {
    console.error("startShareScreen failed:", e);
    const reason = e?.reason || e?.message || e?.type || "unknown error";
    const needsExt =
      e?.type === "INVALID_OPERATION" && e?.extensionUrl
        ? `\nInstall extension: ${e.extensionUrl}`
        : "";
    alert(
      `Unable to start screen share: ${reason}.` +
        "\nTips: allow Screen Sharing in the browser prompt, use HTTPS or localhost, and ensure no other share is active." +
        needsExt,
    );
  }
}

async function stopLocalShare() {
  if (!stream) return;
  try {
    await stream.stopShareScreen();
  } catch (e) {}
  isSharing = false;
  activeShareUserId = null;
  updateShareButton(false);
  hideShareContainer();
}

async function toggleShare() {
  if (!stream || isToggleProcessing) return;
  isToggleProcessing = true;
  try {
    if (isSharing) await stopLocalShare();
    else await startLocalShare();
  } finally {
    isToggleProcessing = false;
  }
}

function stopIncomingShare() {
  if (stream && typeof stream.stopShareView === "function") {
    try {
      stream.stopShareView();
    } catch (e) {}
  }
  if (
    activeShareUserId &&
    activeShareUserId !== client?.getCurrentUserInfo?.().userId
  ) {
    activeShareUserId = null;
  }
  hideShareContainer();
}

function handleShareStart(userId) {
  activeShareUserId = userId;
  const meId = client?.getCurrentUserInfo?.().userId;
  const el = getShareElement(userId === meId);
  if (!el || !stream) return;

  if (userId === meId) {
    isSharing = true;
    showShareContainer("You are sharing");
    updateShareButton(true);
    return;
  }

  try {
    stream.startShareView(el, userId);
    // Ensure canvas is visible, video hidden for remote
    const vid = document.getElementById("share-video");
    const canvas = document.getElementById("share-canvas");
    if (vid) vid.style.display = "none";
    if (canvas) canvas.style.display = "block";
    const user = client.getAllUser().find((u) => u.userId === userId);
    showShareContainer(`${dname(user)} is sharing`);
  } catch (e) {
    console.error("startShareView failed:", e);
    alert(
      "Unable to display shared screen. Please retry or ask the sharer to restart.",
    );
  }
}

function handleShareStop(userId) {
  if (userId === client?.getCurrentUserInfo?.().userId) {
    isSharing = false;
    updateShareButton(false);
  }
  const vid = document.getElementById("share-video");
  const canvas = document.getElementById("share-canvas");
  if (vid) vid.style.display = "block";
  if (canvas) canvas.style.display = "none";
  stopIncomingShare();
}
/* ─── Screen share end ─── */

/* ─── Cloud recording ─── */
function updateRecordingUi(enabled) {
  const btn = document.getElementById("record-btn");
  if (!btn) return;
  btn.disabled = enabled === false;
  btn.classList.toggle("disabled", enabled === false);
  const onIcon = document.getElementById("rec-on");
  const offIcon = document.getElementById("rec-off");
  if (onIcon && offIcon) {
    const isActiveRecording = isRecording && !isRecordingPaused;
    onIcon.style.display = isActiveRecording ? "" : "none";
    offIcon.style.display = isActiveRecording ? "none" : "";
  }
  btn.classList.toggle("active", isRecording && !isRecordingPaused);
}

async function getStatusOfRecording() {
  const status = recordingClient.getCloudRecordingStatus();
  console.log(`Recording Status ==> ${status}`);
}

async function stopRecording() {
  await recordingClient.stopCloudRecording();
  isRecording = false;
  isRecordingPaused = false;
}

async function toggleRecording() {
  if (!recordingClient || isToggleProcessing) return;
  isToggleProcessing = true;
  try {
    if (isRecording) {
      if (isRecordingPaused) {
        await recordingClient.resumeCloudRecording();
        isRecordingPaused = false;
      } else {
        await recordingClient.pauseCloudRecording();
        isRecordingPaused = true;
      }
    } else {
      const allowed = recordingClient.canStartRecording?.();
      if (allowed === false) {
        alert("Cloud recording is not enabled for this session or role.");
        return;
      }
      await recordingClient.startCloudRecording();
      isRecording = true;
      isRecordingPaused = false;
    }
    updateRecordingUi(true);
    getStatusOfRecording();
  } catch (err) {
    console.error("Recording toggle failed:", err);
    alert(
      "Unable to toggle cloud recording. Check host permissions and try again.",
    );
  } finally {
    isToggleProcessing = false;
  }
}

/* ─── Live transcription ─── */
function updateLtUi(enabled) {
  const btn = document.getElementById("lt-btn");
  if (!btn) return;
  btn.disabled = enabled === false;
  btn.classList.toggle("disabled", enabled === false);
  const onIcon = document.getElementById("lt-on");
  const offIcon = document.getElementById("lt-off");
  if (onIcon && offIcon) {
    onIcon.style.display = isTranscribing ? "" : "none";
    offIcon.style.display = isTranscribing ? "none" : "";
  }
  btn.classList.toggle("active", isTranscribing);
}

async function toggleTranscription() {
  if (!ltClient || isToggleProcessing) return;
  isToggleProcessing = true;
  try {
    if (isTranscribing) {
      await ltClient.disableCaptions?.();
      isTranscribing = false;
    } else {
      await ltClient.startLiveTranscription?.();
      isTranscribing = true;
    }
    updateLtUi(true);
  } catch (err) {
    console.error("Live transcription toggle failed:", err);
    alert(
      "Unable to toggle live transcription. Host permission may be required.",
    );
  } finally {
    isToggleProcessing = false;
  }
}

async function changeTranslation(langCode) {
  console.log("langCode", langCode);

  if (!ltClient || isLtChanging) return;
  isLtChanging = true;
  try {
    // Ensure transcription is running before setting translation
    if (!isTranscribing) {
      await ltClient.startLiveTranscription?.();
      isTranscribing = true;
      updateLtUi(true);
    }

    if (langCode === "off") {
      await ltClient.setTranslationLanguage?.(null);
    } else {
      await ltClient.setTranslationLanguage?.(langCode);
    }
  } catch (err) {
    console.error("Change translation failed:", err);
    const reason =
      err?.reason ||
      "Could not change translation language. Please ensure transcription is enabled.";
    alert(reason);
  } finally {
    isLtChanging = false;
  }
}

function updateVbUi(supported) {
  const sel = document.getElementById("vb-select");
  const lbl = document.querySelector("label[for='vb-select']");
  if (!sel || !lbl) return;
  sel.disabled = !supported;
  sel.style.display = supported ? "" : "none";
  lbl.style.display = supported ? "" : "none";
}

/* ─── Virtual background ─── */
function revokeResolvedBg() {
  if (resolvedVirtualBgUrl && resolvedVirtualBgUrl.startsWith("blob:")) {
    URL.revokeObjectURL(resolvedVirtualBgUrl);
  }
  resolvedVirtualBgUrl = null;
}

async function resolveVirtualBg(url) {
  if (!url || url === "none" || url === "blur") return url;
  if (url.startsWith("data:")) return url;
  // Already a blob or same as current
  if (url.startsWith("blob:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    revokeResolvedBg();
    resolvedVirtualBgUrl = URL.createObjectURL(blob);
    return resolvedVirtualBgUrl;
  } catch (e) {
    console.warn("Failed to fetch virtual background image:", e);
    return null;
  }
}

async function setVirtualBackground(value) {
  currentVirtualBg = value || "none";

  const select = document.getElementById("vb-select");
  if (select && select.value !== currentVirtualBg) {
    select.value = currentVirtualBg;
  }

  pendingVirtualBg = currentVirtualBg;
  if (!isVideoOn) {
    return;
  }

  try {
    await restartVideoWithBg(value);
  } catch (e) {
    console.error("VB change failed:", e);
    alert("Failed to change background");
  }
}

function getVBConfig(bg) {
  if (!bg || bg === "none") return undefined;

  return {
    imageUrl: bg,
  };
}

async function restartVideoWithBg(value) {
  try {
    await stream.stopVideo();
    const myId = client.getCurrentUserInfo().userId;
    const myInfo = client.getCurrentUserInfo();
    await stream.startVideo({
      hd: true,
      mirrored: false,
      virtualBackground: getVBConfig(value),
    });
    isVideoOn = true;
    document.getElementById("vid-on").style.display = "";
    document.getElementById("vid-off").style.display = "none";
    document.getElementById("video-btn").classList.add("active");
    setVideoOff(myId, null, false);

    // Ensure my slot exists in grid
    if (!document.getElementById("user-" + myId)) {
      await renderAudioOnlySlot(myId, myInfo);
    }
    const slot = document.getElementById("user-" + myId);
    if (slot) {
      let vpc = slot.querySelector("video-player-container");
      if (!vpc) {
        vpc = document.createElement("video-player-container");
        slot.appendChild(vpc);
      }
      // ✅ Clear stale video-player, attach fresh one (fixes 2nd-toggle bug)
      vpc.innerHTML = "";
      const vp = document.createElement("video-player");
      vpc.appendChild(vp);
      try {
        await stream.attachVideo(myId, 3, vp);
      } catch (e) {
        console.error(e);
      }
    }
  } catch (e) {
    console.error("restartVideoWithBg failed:", e);
    alert("Could not reapply background. " + (e?.message || e));
  }
}

/* ─── Leave ─── */
async function leaveSession() {
  if (isToggleProcessing) return;
  isToggleProcessing = true;
  try {
    if (stream) {
      if (isSharing) await stopLocalShare();
      if (isVideoOn) await stream.stopVideo();
      if (isAudioStarted) await stream.stopAudio();
      for (const u of client.getAllUser()) await removeVideoSlot(u.userId);
    }
    if (client) {
      await client.leave();
      ZoomVideo.destroyClient();
    }
  } finally {
    resetMeetingState();
  }
}

function leaveSessionImmediate() {
  try {
    if (stream) {
      if (isSharing) stopLocalShare();
      if (isVideoOn) stream.stopVideo();
      if (isAudioStarted) stream.stopAudio();
      for (const slot of document.querySelectorAll(".video-slot"))
        slot.remove();
    }
  } catch (e) {
    console.warn("Immediate leave cleanup error:", e);
  }
  try {
    if (client) client.leave();
  } catch (e) {}
  try {
    ZoomVideo.destroyClient();
  } catch (e) {}
  resetMeetingState();
}
// Picture-in-Picture tracking refs
async function enterPictureInPicture(videoContainer) {
  if (
    window.document.pictureInPictureEnabled &&
    "documentPictureInPicture" in window
  ) {
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow();
      pipSourceEl = videoContainer || null;
      // Insert a stub after the container has been transferred to the PipWindow.
      pipPlaceholder = document.createElement("div");
      pipPlaceholder.textContent =
        "The element has been transferred to the PiP window";
      pipPlaceholder.id = "pip-placeholder";
      if (videoContainer) {
        // Ensure styles are applied
        Array.from(document.styleSheets).forEach((styleSheet) => {
          try {
            Array.from(styleSheet.cssRules).forEach((rule) => {
              const style = document.createElement("style");
              style.textContent = rule.cssText;
              pipWindow.document.head.appendChild(style);
            });
          } catch (err) {
            // Skip CORS-protected stylesheets
          }
        });
        // Move the video container into the PiP window
        videoContainer.parentNode?.insertBefore(pipPlaceholder, videoContainer);
        pipWindow.document.body.appendChild(videoContainer);

        pipWindow.addEventListener("pagehide", exitPictureInPicture);
        pipWindow.addEventListener("unload", exitPictureInPicture);
      }
    } catch (error) {
      console.error("Failed to enter Picture-in-Picture mode:", error);
    }
  } else {
    console.warn("Picture-in-Picture is not supported by your browser.");
  }
}

function getPiPSourceElement() {
  const shareEl = document.getElementById("share-container");
  const shareVisible = shareEl && !shareEl.classList.contains("share-hidden");
  if (shareVisible) return shareEl;

  const firstSlot = document.querySelector("#video-grid .video-slot");
  if (firstSlot) return firstSlot;

  return document.getElementById("video-grid");
}

async function togglePictureInPicture() {
  const btn = document.getElementById("pip-btn");
  if (pipWindow) {
    exitPictureInPicture();
    if (btn) btn.classList.remove("active");
    return;
  }
  const source = getPiPSourceElement();
  if (!source) return;
  await enterPictureInPicture(source);
  if (pipWindow && btn) btn.classList.add("active");
}

function exitPictureInPicture() {
  if (!pipWindow || !pipSourceEl) return;
  try {
    // Move the element back to its original place
    if (pipPlaceholder?.parentNode) {
      pipPlaceholder.parentNode.insertBefore(pipSourceEl, pipPlaceholder);
      pipPlaceholder.remove();
    }
  } catch (err) {
    console.error("Failed to restore PiP element:", err);
  } finally {
    pipWindow = null;
    pipSourceEl = null;
    pipPlaceholder = null;
    const btn = document.getElementById("pip-btn");
    if (btn) btn.classList.remove("active");
  }
}

function resetMeetingState() {
  stopTimer();
  isJoined = false;
  client = null;
  stream = null;
  recordingClient = null;
  isRecording = false;
  isRecordingPaused = false;
  ltClient = null;
  isTranscribing = false;
  cmdClient = null;
  raisedHands = [];
  Object.keys(handNameMap).forEach((k) => delete handNameMap[k]);
  isVideoOn = false;
  isAudioMuted = true;
  isAudioStarted = false;
  isSharing = false;
  activeShareUserId = null;
  hideShareContainer();
  updateShareButton(false);
  document.getElementById("video-grid").innerHTML = "";
  updateGridLayout();
  stopRecording();
  document.getElementById("join-container").style.display = "flex";
  document.getElementById("webinar-header").style.display = "none";
  document.getElementById("controls").style.display = "none";
  document.getElementById("start-btn").textContent = "▶ Join Now";
  document.getElementById("mic-on").style.display = "none";
  document.getElementById("mic-off").style.display = "";
  document.getElementById("audio-btn").classList.add("muted");
  document.getElementById("vid-on").style.display = "none";
  document.getElementById("vid-off").style.display = "";
  document.getElementById("video-btn").classList.remove("active");
  const recBtn = document.getElementById("record-btn");
  if (recBtn) {
    recBtn.classList.remove("active");
    recBtn.style.display = "none";
  }
  exitPictureInPicture();
  isToggleProcessing = false;
}

function handleUnload() {
  if (!isJoined) return;
  leaveSessionImmediate();
}

window.addEventListener("beforeunload", handleUnload);
window.addEventListener("unload", handleUnload);
window.addEventListener("pagehide", handleUnload);

// Expose functions for inline onclick handlers in index.html
Object.assign(window, {
  startSession,
  toggleAudio,
  toggleVideo,
  toggleShare,
  stopIncomingShare,
  setVirtualBackground,
  enterPictureInPicture,
  togglePictureInPicture,
  toggleRecording,
  toggleTranscription,
  changeTranslation,
  toggleRaiseHand,
  leaveSession,
});
