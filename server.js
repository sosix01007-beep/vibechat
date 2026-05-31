const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 6e6, // 6MB max per message (รูปภาพ)
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ═══════════════════════════════════════
//  DATA STORE (in-memory)
// ═══════════════════════════════════════
const PUBLIC_ROOMS = ["general", "game", "music", "art", "random"];
const MAX_HISTORY = 100;

const roomHistory = {};      // { roomId: [msg, ...] }
const onlineUsers = {};      // { socketId: userObj }
const privateRooms = {};     // { code: { id, name, owner, members: Set } }
const rateLimiter = {};      // { socketId: { count, resetAt } }

PUBLIC_ROOMS.forEach((r) => (roomHistory[r] = []));

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function generateCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // เช่น A3F9B2
}

function pushHistory(roomId, msg) {
  if (!roomHistory[roomId]) roomHistory[roomId] = [];
  roomHistory[roomId].push(msg);
  if (roomHistory[roomId].length > MAX_HISTORY)
    roomHistory[roomId].shift();
}

// Rate limit: max 10 ข้อความต่อ 5 วินาที
function checkRateLimit(socketId) {
  const now = Date.now();
  if (!rateLimiter[socketId] || now > rateLimiter[socketId].resetAt) {
    rateLimiter[socketId] = { count: 1, resetAt: now + 5000 };
    return true;
  }
  rateLimiter[socketId].count++;
  return rateLimiter[socketId].count <= 10;
}

function getRoomUserCount(roomId) {
  return Object.values(onlineUsers).filter((u) => u.room === roomId).length;
}

// ═══════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════
io.on("connection", (socket) => {
  let user = null;

  // ── Join public room ──
  socket.on("join", ({ name, avatar, room }) => {
    const roomId = PUBLIC_ROOMS.includes(room) ? room : "general";
    user = { id: socket.id, name, avatar, room: roomId, isPrivate: false };
    onlineUsers[socket.id] = user;
    socket.join(roomId);

    socket.emit("history", roomHistory[roomId]);
    io.emit("online_count", Object.keys(onlineUsers).length);

    const sysMsg = {
      type: "system",
      text: `${avatar} ${name} เข้าร่วมห้องแล้ว`,
      ts: Date.now(),
    };
    pushHistory(roomId, sysMsg);
    io.to(roomId).emit("message", sysMsg);
  });

  // ── Switch public room ──
  socket.on("switch_room", (newRoom) => {
    if (!user || !PUBLIC_ROOMS.includes(newRoom)) return;
    socket.leave(user.room);
    user.room = newRoom;
    user.isPrivate = false;
    onlineUsers[socket.id].room = newRoom;
    onlineUsers[socket.id].isPrivate = false;
    socket.join(newRoom);
    socket.emit("history", roomHistory[newRoom]);
  });

  // ── Create private room ──
  socket.on("create_private_room", ({ name: roomName }, callback) => {
    if (!user) return;
    const code = generateCode();
    privateRooms[code] = {
      id: code,
      name: roomName || `ห้องของ ${user.name}`,
      owner: socket.id,
      members: new Set([socket.id]),
    };
    roomHistory[code] = [];

    // ย้ายออกจากห้องเดิม
    socket.leave(user.room);
    user.room = code;
    user.isPrivate = true;
    onlineUsers[socket.id].room = code;
    onlineUsers[socket.id].isPrivate = true;
    socket.join(code);

    socket.emit("history", []);
    callback({ success: true, code, roomName: privateRooms[code].name });
  });

  // ── Join private room with code ──
  socket.on("join_private_room", ({ code }, callback) => {
    if (!user) return;
    const pRoom = privateRooms[code.toUpperCase()];
    if (!pRoom) return callback({ success: false, error: "ไม่พบห้องนี้ หรือ code ผิด" });

    socket.leave(user.room);
    pRoom.members.add(socket.id);
    user.room = code.toUpperCase();
    user.isPrivate = true;
    onlineUsers[socket.id].room = code.toUpperCase();
    onlineUsers[socket.id].isPrivate = true;
    socket.join(code.toUpperCase());

    socket.emit("history", roomHistory[code.toUpperCase()] || []);

    const sysMsg = {
      type: "system",
      text: `${user.avatar} ${user.name} เข้าร่วมห้องแล้ว`,
      ts: Date.now(),
    };
    pushHistory(code.toUpperCase(), sysMsg);
    io.to(code.toUpperCase()).emit("message", sysMsg);

    callback({ success: true, roomName: pRoom.name });
  });

  // ── Message ──
  socket.on("message", ({ text, image }) => {
    if (!user) return;
    if (!checkRateLimit(socket.id)) {
      socket.emit("error_msg", "ส่งเร็วเกินไป รอแป๊บนึงนะ 🐢");
      return;
    }
    if (text && text.length > 500) return;

    const msg = {
      id: `${socket.id}_${Date.now()}`,
      uid: socket.id,
      name: user.name,
      avatar: user.avatar,
      text: text ? text.trim() : "",
      image: image || null, // imgbb URL
      ts: Date.now(),
      reactions: {},
    };
    pushHistory(user.room, msg);
    io.to(user.room).emit("message", msg);
  });

  // ── Reaction ──
  socket.on("react", ({ msgId, emoji, room }) => {
    if (!user) return;
    const msg = roomHistory[room]?.find((m) => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = {};
    if (msg.reactions[emoji][socket.id]) {
      delete msg.reactions[emoji][socket.id];
      if (Object.keys(msg.reactions[emoji]).length === 0)
        delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji][socket.id] = true;
    }
    io.to(room).emit("reaction_update", { msgId, reactions: msg.reactions });
  });

  // ── Typing ──
  socket.on("typing", ({ room, isTyping }) => {
    if (!user) return;
    socket.to(room).emit("typing", { uid: socket.id, name: user.name, isTyping });
  });

  // ══════════════════════════════════════
  //  VOICE CALL (WebRTC Signaling)
  // ══════════════════════════════════════

  // เริ่มโทร
  socket.on("call_user", ({ targetId, offer }) => {
    if (!user) return;
    io.to(targetId).emit("incoming_call", {
      from: socket.id,
      name: user.name,
      avatar: user.avatar,
      offer,
    });
  });

  // รับสาย
  socket.on("call_answer", ({ targetId, answer }) => {
    io.to(targetId).emit("call_answered", { from: socket.id, answer });
  });

  // ปฏิเสธสาย
  socket.on("call_reject", ({ targetId }) => {
    io.to(targetId).emit("call_rejected", { from: socket.id });
  });

  // ICE candidate
  socket.on("ice_candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("ice_candidate", { from: socket.id, candidate });
  });

  // วางสาย
  socket.on("call_end", ({ targetId }) => {
    io.to(targetId).emit("call_ended", { from: socket.id });
  });

  // ══════════════════════════════════════
  //  DISCONNECT
  // ══════════════════════════════════════
  socket.on("disconnect", () => {
    if (!user) return;

    // ออกจาก private room
    if (user.isPrivate && privateRooms[user.room]) {
      const pRoom = privateRooms[user.room];
      pRoom.members.delete(socket.id);
      // ถ้าไม่มีคนในห้องแล้ว ลบห้องทิ้ง
      if (pRoom.members.size === 0) {
        delete privateRooms[user.room];
        delete roomHistory[user.room];
      }
    }

    delete onlineUsers[socket.id];
    delete rateLimiter[socket.id];
    io.emit("online_count", Object.keys(onlineUsers).length);

    const sysMsg = {
      type: "system",
      text: `${user.avatar} ${user.name} ออกจากห้องแล้ว`,
      ts: Date.now(),
    };
    if (roomHistory[user.room]) pushHistory(user.room, sysMsg);
    io.to(user.room).emit("message", sysMsg);

    // แจ้งถ้ากำลังโทรอยู่
    io.emit("call_ended", { from: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VibeChat running on port ${PORT}`));
