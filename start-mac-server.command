#!/bin/bash
cd "/Users/Danh/.gemini/antigravity/scratch/classroom-portal" || exit 1

echo "=========================================================="
echo "   🚀 ĐANG KHỞI ĐỘNG EDUCLASS PORTAL TRÊN MÁY MAC...     "
echo "=========================================================="

# 1. Dừng các tiến trình cũ nếu còn chạy ở cổng 3000 hoặc tunnel
lsof -ti :3000 | xargs kill -9 2>/dev/null
pkill -9 -f "cloudflared tunnel" 2>/dev/null
pkill -9 -f "localhost.run" 2>/dev/null
sleep 1

# 2. Khởi động Node.js Server
node server.js > /tmp/educlass_server.log 2>&1 &
SERVER_PID=$!
sleep 2

# Kiểm tra Server nội bộ đã sẵn sàng chưa
for i in {1..10}; do
    if curl -s -m 2 http://localhost:3000/api/system/status >/dev/null 2>&1; then
        echo "✅ Máy chủ nội bộ đã khởi động thành công (Port 3000)."
        break
    fi
    sleep 1
done

# 3. Ưu tiên 1: Khởi động Cloudflare Tunnel (Tốc độ cao, không bao giờ bị bóp băng thông)
echo "⏳ Đang kết nối mạng Cloudflare để tạo đường link công khai cho sinh viên..."
rm -f /tmp/cloudflared.log /tmp/tunnel.log
./cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
CF_PID=$!

PUBLIC_URL=""
for i in {1..25}; do
    PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' /tmp/cloudflared.log | head -n 1)
    if [ -n "$PUBLIC_URL" ]; then
        break
    fi
    sleep 1
done

# Đợi đường truyền Cloudflare ổn định (thường mất 3-5 giây)
if [ -n "$PUBLIC_URL" ]; then
    echo "🔗 Đã nhận link Cloudflare, đang xác thực kết nối..."
    for j in {1..15}; do
        HTTP_CODE=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "$PUBLIC_URL/api/system/status" 2>/dev/null)
        if [ "$HTTP_CODE" = "200" ]; then
            echo "✅ Đường truyền Cloudflare đã thông suốt!"
            break
        fi
        sleep 1
    done
fi

# Fallback: Nếu Cloudflare không lấy được link thì mới dùng localhost.run
if [ -z "$PUBLIC_URL" ]; then
    echo "⚠️ Đang thử kênh dự phòng (localhost.run)..."
    ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run > /tmp/tunnel.log 2>&1 &
    TUNNEL_PID=$!
    for i in {1..20}; do
        PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9]*\.app\.lhr\.life' /tmp/tunnel.log | head -n 1)
        if [ -n "$PUBLIC_URL" ]; then
            break
        fi
        sleep 1
    done
fi

if [ -n "$PUBLIC_URL" ]; then
    echo ""
    echo "=========================================================="
    echo "🎉 HỆ THỐNG ĐÃ SẴN SÀNG HOẠT ĐỘNG!"
    echo "----------------------------------------------------------"
    echo "👨‍🏫 THẦY DANH TRUY CẬP (Siêu tốc & Ổn định tuyệt đối):"
    echo "   👉 http://localhost:3000"
    echo ""
    echo "🌐 ĐƯỜNG LINK GỬI CHO SINH VIÊN (4G/5G/Wi-Fi):"
    echo "   👉 $PUBLIC_URL"
    echo "=========================================================="
    echo ""
    
    # Cập nhật file trên Desktop
    echo "ĐƯỜNG LINK TRUY CẬP LỚP HỌC (EDUCLASS PORTAL):
$PUBLIC_URL

(Thầy chỉ cần copy link trên và gửi cho học sinh trong lớp, mở được trên mọi mạng 4G/5G/Wi-Fi)" > /Users/Danh/Desktop/LINK-LOP-HOC.txt

    echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
	<key>URL</key>
	<string>$PUBLIC_URL</string>
</dict>
</plist>" > /Users/Danh/Desktop/LINK-LOP-HOC.webloc

    # Tự động copy link sinh viên vào Clipboard
    echo "$PUBLIC_URL" | pbcopy
    echo "📋 Đã tự động sao chép link sinh viên vào bộ nhớ tạm (Clipboard) của Mac!"
    echo "Thầy chỉ cần nhấn Cmd + V để gửi link cho sinh viên."
    echo ""
    
    # Mở localhost:3000 trên máy của Thầy (trải nghiệm mượt nhất)
    open "http://localhost:3000"
else
    echo "⚠️ Chưa lấy được link Internet. Đường link nội bộ Wi-Fi:"
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
    echo "👉 http://${LOCAL_IP}:3000"
    open "http://localhost:3000"
fi

echo ""
echo "💡 HƯỚNG DẪN: Giữ cửa sổ này mở trong suốt buổi học."
echo "Khi kết thúc buổi học, Thầy chỉ cần bấm phím tắt Ctrl + C hoặc đóng cửa sổ Terminal này."
echo ""

# Dọn dẹp khi tắt
trap "kill $SERVER_PID $TUNNEL_PID $CF_PID 2>/dev/null; exit 0" INT TERM EXIT

wait $SERVER_PID
