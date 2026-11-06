const { app, BrowserWindow, Menu, shell, clipboard, Notification, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const PORT = process.env.PORT || 3000;
const LOCAL_URL = `http://localhost:${PORT}`;
const RENDER_CLOUD_URL = 'https://classroom-portal-jlkb.onrender.com';
const MAC_SUBMISSIONS_DIR = path.join(os.homedir(), 'Downloads', 'EduClass_BaiTap');

let mainWindow = null;
let serverInstance = null;

// Khóa đơn phiên bản (Single Instance Lock) - Chỉ cho phép chạy 1 app duy nhất
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Thiết lập thư mục dữ liệu chuẩn trên macOS (~/Library/Application Support/EduClass/data)
function setupUserDataDir() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Khởi tạo data.json ban đầu nếu chưa có trong thư mục Application Support
  const targetDataFile = path.join(userDataDir, 'data.json');
  if (!fs.existsSync(targetDataFile)) {
    const bundledDataFile = path.join(__dirname, 'data.json');
    if (fs.existsSync(bundledDataFile)) {
      try {
        fs.copyFileSync(bundledDataFile, targetDataFile);
        console.log('[Desktop] Đã sao chép data.json ban đầu vào Application Support');
      } catch (err) {
        console.error('[Desktop] Lỗi sao chép data.json:', err);
      }
    }
  }

  process.env.EDUCLASS_DATA_DIR = userDataDir;
  console.log('[Desktop] Thư mục dữ liệu cục bộ:', userDataDir);
}

// Kiểm tra xem server cục bộ đã chạy chưa
function checkServerReady(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.abort();
      resolve(false);
    });
  });
}

// Lấy IP Wi-Fi/LAN của máy Mac
function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const ifaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[ifaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Khởi chạy server Express ngầm
async function startEmbeddedServer() {
  const isAlreadyRunning = await checkServerReady(LOCAL_URL, 800);
  if (isAlreadyRunning) {
    console.log('[Desktop] Server cục bộ đã đang chạy, kết nối trực tiếp...');
    return;
  }

  try {
    console.log('[Desktop] Đang khởi động backend Express tích hợp...');
    setupUserDataDir();
    // Chạy server.js trực tiếp trong tiến trình
    require('./server.js');
    console.log('[Desktop] Backend Express đã nạp thành công');
  } catch (err) {
    console.error('[Desktop] Lỗi khởi động backend:', err);
  }
}

// Tạo cửa sổ chính ứng dụng macOS
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: 'EduClass Portal - Cổng Quản Lý Lớp Học & Bài Tập',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0f172a',
    titleBarStyle: 'default',
    show: false, // Ẩn đến khi sẵn sàng để tránh chớp trắng
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  });

  // Khi cửa sổ sẵn sàng hiển thị
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Tải giao diện portal cục bộ
  mainWindow.loadURL(LOCAL_URL);

  // Xử lý khi người dùng click vào các link ra ngoài
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Tạo Menu thanh công cụ chuẩn macOS
function buildApplicationMenu() {
  const lanIp = getLocalLanIp();
  const lanUrl = `http://${lanIp}:${PORT}`;

  const template = [
    {
      label: 'EduClass',
      submenu: [
        {
          label: 'Về EduClass Portal',
          click: () => {
            if (mainWindow) {
              shell.openExternal('https://classroom-portal-jlkb.onrender.com');
            }
          }
        },
        { type: 'separator' },
        { role: 'services', label: 'Dịch vụ' },
        { type: 'separator' },
        { role: 'hide', label: 'Ẩn EduClass' },
        { role: 'hideOthers', label: 'Ẩn các cửa sổ khác' },
        { role: 'unhide', label: 'Hiện tất cả' },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát EduClass' }
      ]
    },
    {
      label: 'Quản Lý',
      submenu: [
        {
          label: '🌐 Chuyển sang Web Render (Đám Mây)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(RENDER_CLOUD_URL);
            }
          }
        },
        {
          label: '💻 Chuyển về Trạm Chủ (Local)',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(LOCAL_URL);
            }
          }
        },
        { type: 'separator' },
        {
          label: '📋 Sao chép Link Render (cho học sinh từ xa)',
          click: () => {
            clipboard.writeText(RENDER_CLOUD_URL);
            if (Notification.isSupported()) {
              new Notification({
                title: 'EduClass Portal',
                body: `Đã sao chép Link Render: ${RENDER_CLOUD_URL}`
              }).show();
            }
          }
        },
        {
          label: '📋 Sao chép Link LAN Wi-Fi (cho phòng máy)',
          click: () => {
            clipboard.writeText(lanUrl);
            if (Notification.isSupported()) {
              new Notification({
                title: 'EduClass Portal',
                body: `Đã sao chép Link LAN Wi-Fi: ${lanUrl}`
              }).show();
            }
          }
        },
        { type: 'separator' },
        {
          label: '📂 Mở Thư mục Bài Nộp trên máy Mac (Finder)',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (!fs.existsSync(MAC_SUBMISSIONS_DIR)) {
              fs.mkdirSync(MAC_SUBMISSIONS_DIR, { recursive: true });
            }
            shell.openPath(MAC_SUBMISSIONS_DIR);
          }
        },
        { type: 'separator' },
        {
          label: '🔄 Tải Lại Trang',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        }
      ]
    },
    {
      label: 'Chỉnh Sửa',
      submenu: [
        { role: 'undo', label: 'Hoàn tác' },
        { role: 'redo', label: 'Làm lại' },
        { type: 'separator' },
        { role: 'cut', label: 'Cắt' },
        { role: 'copy', label: 'Sao chép' },
        { role: 'paste', label: 'Dán' },
        { role: 'selectAll', label: 'Chọn tất cả' }
      ]
    },
    {
      label: 'Hiển Thị',
      submenu: [
        { role: 'resetZoom', label: 'Cỡ chữ chuẩn' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' },
        {
          label: 'Công cụ lập trình (DevTools)',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Cửa Sổ',
      submenu: [
        { role: 'minimize', label: 'Thu nhỏ cửa sổ' },
        { role: 'zoom', label: 'Phóng to cửa sổ' },
        { type: 'separator' },
        { role: 'front', label: 'Đưa lên trên cùng' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Cấu hình menu chuột phải trên Dock của macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: '📂 Mở thư mục bài tập (Finder)',
        click: () => {
          if (!fs.existsSync(MAC_SUBMISSIONS_DIR)) {
            fs.mkdirSync(MAC_SUBMISSIONS_DIR, { recursive: true });
          }
          shell.openPath(MAC_SUBMISSIONS_DIR);
        }
      },
      {
        label: '🌐 Mở Web Render',
        click: () => {
          shell.openExternal(RENDER_CLOUD_URL);
        }
      },
      {
        label: '📋 Copy Link Web Render',
        click: () => {
          clipboard.writeText(RENDER_CLOUD_URL);
        }
      }
    ]);
    app.dock.setMenu(dockMenu);
  }
}

// Khi Electron đã sẵn sàng
app.whenReady().then(async () => {
  buildApplicationMenu();
  await startEmbeddedServer();

  // Đợi thêm một chút để đảm bảo server đã lắng nghe
  let ready = false;
  let attempts = 0;
  while (!ready && attempts < 15) {
    ready = await checkServerReady(LOCAL_URL, 400);
    if (!ready) {
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Thoát khi tất cả cửa sổ bị đóng (trừ trên macOS người dùng tắt hẳn bằng Cmd+Q)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
