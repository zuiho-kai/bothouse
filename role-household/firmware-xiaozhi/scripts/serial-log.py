"""读板子串口日志若干秒，不复位板子（DTR/RTS 保持不动）。用法：python serial-log.py /dev/cu.usbmodem101 秒数 [输出文件]"""
import sys, time
import serial
port, secs = sys.argv[1], float(sys.argv[2])
out = open(sys.argv[3], "ab") if len(sys.argv) > 3 else sys.stdout.buffer
s = serial.Serial()
s.port, s.baudrate, s.timeout = port, 115200, 0.2
s.dtr, s.rts = (sys.argv[4] == "dtr") if len(sys.argv) > 4 else False, False
s.open()
end = time.time() + secs
while time.time() < end:
    d = s.read(4096)
    if d:
        out.write(d); out.flush()
s.close()
