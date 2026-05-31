# 💬 VibeChat

แชท realtime ไม่ต้องสมัคร ใช้ Socket.io + Node.js

## ฟีเจอร์
- แชท realtime กับคนอื่นจริงๆ
- 5 ห้อง (ทั่วไป / เกม / ดนตรี / ศิลปะ / มั่ว)
- เห็นคนออนไลน์ + กำลังพิมพ์
- React ข้อความได้ (double tap หรือ long press)
- ตั้งชื่อ + เลือก emoji avatar เอง
- รองรับมือถือและคอม

## วิธี Deploy

### 1. Push ขึ้น GitHub
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vibechat.git
git push -u origin main
```

### 2. Deploy บน Railway
1. ไปที่ https://railway.app → New Project
2. เลือก **Deploy from GitHub repo**
3. เลือก repo `vibechat`
4. Railway จะ detect Node.js และ deploy อัตโนมัติ
5. ไปที่ Settings → Networking → **Generate Domain**
6. ได้ URL สาธารณะ แชร์เพื่อนได้เลย!

### รันบนเครื่องตัวเอง
```bash
npm install
npm start
# เปิด http://localhost:3000
```

## Tech Stack
- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JS
- **Deploy**: Railway (ฟรี $5/เดือน)
