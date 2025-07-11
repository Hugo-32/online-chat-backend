require('./models/db')

const User = require('./models/User');

User.sync({ alter: true })
    .then(() => console.log('Таблица User синхронизирована с БД'))
    .catch(err => console.error('Ошибка синхронизации User:', err));

const Admin = require('./models/Admin');

Admin.sync({ alter: true })
    .then(() => console.log('Таблица Admin синхронизирована с БД'))
    .catch(err => console.error('Ошибка синхронизации Admin:', err));

const Message = require('./models/Message');

Message.sync({ alter: true })
    .then(() => console.log('Таблица Message синхронизирована с БД'))
    .catch(err => console.error('Ошибка синхронизации Message:', err));


const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');

const userSockets = {};
const socketUsers = {};
const reports = {}; 
const SPAM_LIMIT = 2; // лимит жалоб для скрытия сообщения

app.use(cors({ origin: "*" }));

const storage = multer.diskStorage({
     destination: (req, file, cb) => cb(null, 'uploads/'),
     filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
   });
   const upload = multer({ storage });

   app.use('/uploads', express.static('uploads'));


app.post('/upload', upload.single('photo'), async (req, res) => {
    const room = req.body.room;
    const user = req.body.user;
    const caption = req.body.caption;
    const url = `/uploads/${req.file.filename}`;
    const mimeType = req.file.mimetype;

    // Определяем тип сообщения
    let type = 'file';
    if (mimeType.startsWith("image/")) {
        type = 'image';
    } else if (mimeType.startsWith("video/")) {
        type = 'video';
    } else if (
        mimeType === "application/pdf" ||
        mimeType === "application/msword" ||
        mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
        type = 'doc';
    }

    let dbUser = await User.findOne({ where: { username: user } });

    await Message.create({
        content: 'Файл',
        room,
        userId: dbUser.id,
        type,
        fileUrl: url
    });

    let html = "";
    if (type === 'image') {
        html = `<img src="http://localhost:5000${url}" alt="" style="max-width:250px; width:100%; height:auto; border-radius:8px;"/><br/>`;
    } else if (type === 'video') {
        html = `<video src="http://localhost:5000${url}" controls style="max-width:400px; width:100%; border-radius:8px; margin: 8px 0;"></video><br/>`;
    } else if (type === 'doc') {
        html = `<a href="http://localhost:5000${url}" target="_blank" rel="noopener noreferrer" style="color:#4faaff; text-decoration:underline; font-size:18px;">
                    📄 Скачать файл: ${req.file.originalname}
                </a><br/>`;
    } else {
        html = `<a href="http://localhost:5000${url}" target="_blank" rel="noopener noreferrer">
                    Скачать файл: ${req.file.originalname}
                </a><br/>`;
    }
    if (caption && caption.trim() !== "") {
        html += `<span class="caption">${caption}</span>`;
    }
    
    const createdMessage = await Message.create({
        content: caption || 'Файл',
        room,
        userId: dbUser.id,
        type,
        fileUrl: url
    });

    io.to(room).emit('message', {
        data: {
            id: createdMessage.id,
            user: { name: user },
            message: html
        }
    });

    res.json({ url });
});

app.get('/history/:room', async (req, res) => {
    const { room } = req.params;
    try {
        // Получаем все не скрытые сообщения для комнаты, сортируем по времени
        const messages = await Message.findAll({
            where: { room, isHidden: false },
            order: [['createdAt', 'ASC']],
            include: [{ model: User, attributes: ['username'] }]
        });
        res.json(messages.map(msg => ({
            id: msg.id,
            user: { name: msg.User ? msg.User.username : 'Неизвестно' },
            message: msg.content,
            type: msg.type,
            fileUrl: msg.fileUrl,
            createdAt: msg.createdAt
        })));
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения истории' });
    }
});

app.post('/deleteMessage', express.json(), async (req, res) => {
    const { messageId, adminName, room } = req.body;

    const admin = await Admin.findOne({ where: { username: adminName } });
    if (!admin) {
        return res.status(403).json({ error: 'Not allowed' });
    }

    await Message.update(
        { isHidden: true, hiddenReason: 'Удалено администратором' },
        { where: { id: messageId } }
    );

    io.to(room).emit('deleteMessage', { messageId });
    res.json({ status: 'ok' });
});

app.post('/blockUser', express.json(), async (req, res) => {
    const { targetUser, adminName, duration, room } = req.body;

    const admin = await Admin.findOne({ where: { username: adminName } });
    if (!admin) {
        return res.status(403).json({ error: 'Not allowed' });
    }

    const until = duration ? new Date(Date.now() + duration * 1000) : null;
    const reason = duration ? 'Временная блокировка' : 'Постоянная блокировка';

    blockedUsers[targetUser] = { blocked: true, until };

    // --- Обновляем пользователя в базе ---
    const dbUser = await User.findOne({ where: { username: targetUser } });
    if (dbUser) {
        await dbUser.update({
            isBanned: true,
            banReason: reason,
            banExpires: until
        });

        // Скрываем все сообщения пользователя
        await Message.update(
            { isHidden: true, hiddenReason: 'Пользователь заблокирован' },
            { where: { userId: dbUser.id } }
        );
    }

    const userSocketId = userSockets[targetUser];
    if (userSocketId) {
        io.to(userSocketId).emit('userBlocked', { username: targetUser });
        setTimeout(() => {
            io.sockets.sockets.get(userSocketId)?.disconnect(true);
            delete userSockets[targetUser];
        }, 200);
    }

    io.to(room).emit('blockUserMessages', { username: targetUser });
    res.json({ status: 'ok' });
});

app.post('/admin-login', express.json(), async (req, res) => {
    const { name, password } = req.body;
    const admin = await Admin.findOne({ where: { username: name } });
    if (!admin) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // const isMatch = await bcrypt.compare(password, admin.password);
    // if (!isMatch) {
    //     return res.status(401).json({ error: 'Неверный логин или пароль' });
    // }

    if (admin.password !== password) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    res.json({ success: true });
});

app.post('/report', express.json(), async (req, res) => {
    const { messageId, reporter } = req.body;
    if (!reports[messageId]) {
        reports[messageId] = [];
    }

    if (!reports[messageId].includes(reporter)) {
        reports[messageId].push(reporter);
    }

    if (reports[messageId].length >= SPAM_LIMIT) {
        await Message.update(
            { isHidden: true, hiddenReason: 'Скрыто из-за жалоб' },
            { where: { id: messageId } }
        );
        io.emit('hideMessage', { messageId });
    }
    res.json({ status: 'ok', count: reports[messageId].length });
});

const route = require("./route");
const { addUser, findUser, getRoomUsers, removeUser, admins, blockedUsers } = require("./users");

app.use("/", route);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

io.on('connection', (socket) => {
    socket.on('join', async ({ name, room}) => {
        let dbUser = await User.findOne({ where: { username: name } });
        if (!dbUser) {
            dbUser = await User.create({
                username: name,
                //password: '', 
                role: 'user'
            });
        }

        userSockets[name] = socket.id;
        socketUsers[socket.id] = { name, room };
        const found = findUser({ name, room });
        if (found && found.error === 'User is blocked') {
            const blockInfo = blockedUsers[name];
            let reason = 'Вы заблокированы!';
            if (blockInfo && blockInfo.until) {
                const msLeft = blockInfo.until - Date.now();
                const minLeft = Math.ceil(msLeft / 60000);
                reason = `Вы временно заблокированы! До разблокировки осталось ${minLeft} мин.`;
            }
            socket.emit('blocked', { reason });
            return;
        }
        socket.join(room);
 
        const { user, isExist } = addUser({ name, room});

        const userMessage = isExist 
            ? `${user.name}, снова с нами` 
            : `Привет, ${user.name} 👋`

        socket.emit("message", {
            data: {user: { name: "Bot" }, message: userMessage }
        });

        socket.broadcast.to(user.room).emit('message', {
            data: {user: { name: "Bot" }, message: `${user.name} присоединился 👋` }
        })

        io.to(user.room).emit('room', {
            data: { users: getRoomUsers(user.room)},
        })
    });

    socket.on('sendMessage', async ({ message, params }) => {
        const user = findUser(params);
    
        if (user) {
            const dbUser = await User.findOne({ where: { username: user.name } });
    
            const createdMessage = await Message.create({
                content: message,
                room: user.room,
                userId: dbUser ? dbUser.id : null,
                type: 'text',
            });
    
            io.to(user.room).emit('message', { data: { id: createdMessage.id, user, message }});
        }
    });

    socket.on('leftRoom', ({ params }) => {
        const user = removeUser(params);

        if (user) {
            const { room, name } = user

            io.to(user.room).emit('message', { data: { user: { name: "Bot" }, message: `${name} has left the room` }});

            io.to(room).emit('room', {
                data: { users: getRoomUsers(room)},
            })
        }
    })

    socket.on('disconnect', () => {
        const userData = socketUsers[socket.id];
        if (userData) {
            const { name, room } = userData;
            delete userSockets[name];
            delete socketUsers[socket.id];
            const user = removeUser({ name, room });
            if (user) {
                io.to(room).emit('room', {
                    data: { users: getRoomUsers(room) }
                });
            }
        }
    });
});

server.listen(5000, () => {
    console.log("Server is running on port 5000");
});