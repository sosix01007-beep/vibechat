const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const ROOMS = ["general", "game", "music", "art", "random"];
const MAX_HISTORY = 100;

const roomHistory = {};
const onlineUsers = {};

ROOMS.forEach((r) => (roomHistory[r] = []));

function pushHistory(room, msg) {
  roomHistory[room].push(msg);
  if (roomHistory[room].length > MAX_HISTORY) roomHistory[room].shift();
}

io.on("connection", (socket) => {
  let user = null;

  socket.on("join", ({ name, avatar, room }) => {
    user = { id: socket.id, name, avatar, room: room || "general" };
    onlineUsers[socket.id] = user;
    socket.join(user.room);

    socket.emit("history", roomHistory[user.room]);
    socket.emit("online_count", Object.keys(onlineUsers).length);
    io.emit("online_count", Object.keys(onlineUsers).length);

    const sysMsg = {
      type: "system",
      text: `${user.avatar} ${user.name} เข้าร่วมห้องแล้ว`,
      ts: Date.now(),
    };
    pushHistory(user.room, sysMsg);
    io.to(user.room).emit("message", sysMsg);
  });

  socket.on("switch_room", (newRoom) => {
    if (!user || !ROOMS.includes(newRoom)) return;
    socket.leave(user.room);
    user.room = newRoom;
    onlineUsers[socket.id].room = newRoom;
    socket.join(newRoom);
    socket.emit("history", roomHistory[newRoom]);
  });

  socket.on("message", ({ text }) => {
    if (!user || !text?.trim()) return;
    const msg = {
      id: `${socket.id}_${Date.now()}`,
      uid: socket.id,
      name: user.name,
      avatar: user.avatar,
      text: text.trim().slice(0, 500),
      ts: Date.now(),
      reactions: {},
    };
    pushHistory(user.room, msg);
    io.to(user.room).emit("message", msg);
  });

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

  socket.on("typing", ({ room, isTyping }) => {
    if (!user) return;
    socket.to(room).emit("typing", {
      uid: socket.id,
      name: user.name,
      isTyping,
    });
  });

  socket.on("disconnect", () => {
    if (!user) return;
    delete onlineUsers[socket.id];
    io.emit("online_count", Object.keys(onlineUsers).length);
    const sysMsg = {
      type: "system",
      text: `${user.avatar} ${user.name} ออกจากห้องแล้ว`,
      ts: Date.now(),
    };
    pushHistory(user.room, sysMsg);
    io.to(user.room).emit("message", sysMsg);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VibeChat running on port ${PORT}`));
