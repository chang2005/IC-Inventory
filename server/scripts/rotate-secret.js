/** 生成随机 JWT 密钥并写回 .env（部署前执行一次） */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = path.join(__dirname, '../../.env');
let s = fs.readFileSync(file, 'utf8');
const secret = crypto.randomBytes(32).toString('hex');
if (/^JWT_SECRET=/m.test(s)) {
  s = s.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + secret);
} else {
  s += '\nJWT_SECRET=' + secret + '\n';
}
fs.writeFileSync(file, s, 'utf8');
console.log('JWT_SECRET 已更新（48 位随机十六进制），请重启服务生效');
