#!/bin/bash
cd "/Users/Danh/.gemini/antigravity/scratch/classroom-portal" || exit 1

echo "=========================================================="
echo "   🚀 ĐANG KHỞI ĐỘNG EDUCLASS PORTAL TRÊN MÁY MAC...     "
echo "=========================================================="

# 1. Dừng các tiến trình cũ nếu còn đang chạy ở cổng 3000 hoặc cloudflared
lsof -ti :3000 | xargs kill -9 2>/dev/null
pkill -f "cloudflared tunnel --url" 2>/dev/null
sleep 1

# 2. Khởi động Node.js Server
node server.js > /tmp/educlass_server.log 2>&1 &
SERVER_PID=$!
sleep 2

# 3. Khởi động Cloudflare Tunnel để tạo link công khai miễn phí
./cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
TUNNEL_PID=$!

echo "⏳ Đang kết nối mạng Cloudflare để tạo đường link công khai..."
PUBLIC_URL=""
for i in {1..30}; do
    PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' /tmp/cloudflared.log | head -n 1)
    if [ -n "$PUBLIC_URL" ]; then
        break
    fi
    sleep 1
done

if [ -n "$PUBLIC_URL" ]; then
    echo ""
    echo "=========================================================="
    echo "🎉 ĐÃ TẠO ĐƯỜNG LINK THÀNH CÔNG (100% MIỄN PHÍ - BĂNG THÔNG VÔ HẠN)!"
    echo "🌐 ĐƯỜNG LINK TRUY CẬP CHO HỌC SINH & GIÁO VIÊN:"
    echo "   👉 $PUBLIC_URL"
    echo "=========================================================="
    echo ""
    # Tự động copy vào Clipboard
    echo "$PUBLIC_URL" | pbcopy
    echo "📋 Đã tự động sao chép đường link vào bộ nhớ tạm (Clipboard) của Mac!"
    echo "Thầy chỉ cần nhấn Cmd + V để dán và gửi link cho học sinh."
    echo ""
    open "$PUBLIC_URL"
else
    echo "⚠️ Chưa lấy được link Cloudflare. Đường link nội bộ Wi-Fi:"
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
    echo "👉 http://${LOCAL_IP}:3000"
    open "http://localhost:3000"
fi

echo ""
echo "💡 HƯỚNG DẪN: Giữ cửa sổ này mở trong suốt buổi học."
echo "Khi kết thúc buổi học, Thầy chỉ cần bấm phím tắt Ctrl + C hoặc đóng cửa sổ Terminal này."
echo ""

# Dọn dẹp khi tắt
trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit 0" INT TERM EXIT

wait $SERVER_PID
