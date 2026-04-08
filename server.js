const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const vapidKeys = {
  publicKey: 'BOYMK5_gp4Zg15FSynztVZOz3a_BDku_veULa5JabJN8fOXvb7FtFgs_tqzr4Q51k6MvijF5TubLrqCvPaukAo8',
  privateKey: 'SA1TszMxtNYn-EP4kmCdCZsMGnF3TmIQdvG6BE8gR3Q'
};

webpush.setVapidDetails(
  'mailto:test@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let subscriptions = [];
const reminders = new Map();

const sslOptions = {
  key: fs.readFileSync('./certs/localhost+2-key.pem'),
  cert: fs.readFileSync('./certs/localhost+2.pem')
};

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  socket.on('newTask', (task) => {
    io.emit('taskAdded', task);
    const payload = JSON.stringify({
      title: 'Новая задача',
      body: task.text
    });
    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload).catch(() => {});
    });
  });

  socket.on('newReminder', (reminder) => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();
    if (delay <= 0) return;

    const timeoutId = setTimeout(() => {
      const payload = JSON.stringify({
        title: '!!! Напоминание',
        body: text,
        reminderId: id
      });
      subscriptions.forEach(sub => {
        webpush.sendNotification(sub, payload).catch(() => {});
      });
      reminders.delete(id);
    }, delay);

    reminders.set(id, { timeoutId, text, reminderTime });
  });
});

app.post('/subscribe', (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({ message: 'Subscribed' });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
  res.status(200).json({ message: 'Unsubscribed' });
});

app.post('/snooze', (req, res) => {
  const reminderId = parseInt(req.query.reminderId, 10);
  if (!reminderId || !reminders.has(reminderId)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newDelay = 5 * 60 * 1000;
  const newTimeoutId = setTimeout(() => {
    const payload = JSON.stringify({
      title: 'Напоминание отложено',
      body: reminder.text,
      reminderId: reminderId
    });
    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload).catch(() => {});
    });
    reminders.delete(reminderId);
  }, newDelay);

  reminders.set(reminderId, {
    timeoutId: newTimeoutId,
    text: reminder.text,
    reminderTime: Date.now() + newDelay
  });

  res.status(200).json({ message: 'Snoozed' });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});