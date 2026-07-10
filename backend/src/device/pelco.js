const ADDR = 0x00;

// Pelco-D command bytes [Cmd1, Cmd2, Data1(speed_pan), Data2(speed_tilt)].
// Confirmed from the original exe's Prompt Area log + live network capture:
//   pan-right  FF 00 00 02 28 00 2a   pan-left FF 00 00 04 28 00 2c   (Data1=0x28 = Speed_H 40)
//   tilt-up    FF 00 00 08 00 3F 47   tilt-down FF 00 00 10 00 3F 4F  (Data2=0x3F = Speed_V 63)
//   laser-on   FF 00 00 09 00 02 0b   laser-off FF 00 00 0b 00 02 0d  (Pelco-D AUX on/off)
//   stop       FF 00 00 00 00 00 00
const COMMANDS = {
  stop: [0x00, 0x00, 0x00, 0x00],
  "pan-right": [0x00, 0x02, 0x28, 0x00],
  "pan-left": [0x00, 0x04, 0x28, 0x00],
  "tilt-up": [0x00, 0x08, 0x00, 0x3f],
  "tilt-down": [0x00, 0x10, 0x00, 0x3f],
  "laser-on": [0x00, 0x09, 0x00, 0x02],
  "laser-off": [0x00, 0x0b, 0x00, 0x02],
};

function buildFrame(cmdBytes) {
  const [cmd1, cmd2, data1, data2] = cmdBytes;
  const checksum = (ADDR + cmd1 + cmd2 + data1 + data2) & 0xff;
  return Buffer.from([0xff, ADDR, cmd1, cmd2, data1, data2, checksum]);
}

// Set Angle_H / Angle_V: confirmed from exe Prompt Area log across two test points
// (H=30->FF 00 00 4B 0B B8 0E, H=100->FF 00 00 4B 27 10 82; V=10->...4D 03 E8 38, V=45->...4D 11 94 F2).
// Value = degrees * 100, packed as 16-bit big-endian into Data1(hi)/Data2(lo).
function buildAngleFrame(cmd2, degrees) {
  const v = Math.round(degrees * 100) & 0xffff;
  const data1 = (v >> 8) & 0xff;
  const data2 = v & 0xff;
  return buildFrame([0x00, cmd2, data1, data2]);
}

// Query Angle_H/V: confirmed via live capture.
//   send FF 00 00 51 00 00 51 -> reply FF 00 00 59 [HI] [LO] cs  (Angle_H)
//   send FF 00 00 53 00 00 53 -> reply FF 00 00 5B [HI] [LO] cs  (Angle_V)
// Value = degrees * 100, 16-bit big-endian, same encoding as Set Angle_H/V.
const QUERY_H = Buffer.from([0xff, 0x00, 0x00, 0x51, 0x00, 0x00, 0x51]);
const QUERY_V = Buffer.from([0xff, 0x00, 0x00, 0x53, 0x00, 0x00, 0x53]);

module.exports = { COMMANDS, buildFrame, buildAngleFrame, QUERY_H, QUERY_V };
