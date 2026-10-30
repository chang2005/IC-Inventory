/**
 * 初始化数据库
 *   演示模式（默认）：建表 + 演示数据（45 个器件、3 套 BOM、库存与单据流水）
 *   空库模式：node server/scripts/init-db.js --empty
 *            仅建表 + 超级管理员账号 + 基础分类，适合部署到生产服务器
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'qjcrk',
  multipleStatements: true,
  decimalNumbers: true
};

// ---------- 工具 ----------
let seed = 20261030;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
const money = (a, b) => Number((rnd() * (b - a) + a).toFixed(4));
const pad = (n, l = 4) => String(n).padStart(l, '0');
const dstr = d => {
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const dayAgo = n => new Date(Date.now() - n * 86400000);
const notFuture = d => {
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d;
};

// ---------- 主数据 ----------
const CATEGORIES = [
  ['电阻', 'RES', 1], ['电容', 'CAP', 2], ['电感', 'IND', 3], ['二极管', 'DIO', 4],
  ['三极管/MOS', 'TRA', 5], ['MCU/处理器', 'MCU', 6], ['存储', 'MEM', 7], ['连接器', 'CON', 8],
  ['电源管理', 'PWR', 9], ['晶振', 'XTAL', 10], ['传感器', 'SEN', 11], ['PCB/辅料', 'PCB', 12]
];

const SUPPLIERS = [
  ['SUP-001', '深圳市华强电子科技有限公司', '张伟', '0755-8321-6688', 'sales@hqelec.cn', '深圳市福田区华强北路1058号', 5],
  ['SUP-002', '上海芯合微电子有限公司', '李静', '021-6488-2210', 'sales@xinhe-ic.com', '上海市徐汇区漕河泾开发区宜山路900号', 4],
  ['SUP-003', '东莞联诚精密电子有限公司', '陈志强', '0769-8123-4567', 'sales@lc-precision.cn', '东莞市长安镇乌沙工业区兴发路18号', 4],
  ['SUP-004', '贸泽电子（上海）有限公司', '王琳', '021-6237-9888', 'cn-sales@mouser.com', '上海市浦东新区张江高科技园区', 5],
  ['SUP-005', '深圳立创电子科技有限公司', '刘洋', '0755-8366-1188', 'service@lcsc.com', '深圳市南山区科技园南区', 5],
  ['SUP-006', '世强先进（深圳）科技股份有限公司', '赵敏', '0755-2671-2288', 'sales@sekorm.com', '深圳市南山区高新南一道29号', 4],
  ['SUP-007', '中电港技术股份有限公司', '孙浩', '010-8268-5566', 'sales@cecport.com', '北京市海淀区中关村南大街6号', 4],
  ['SUP-008', '深圳市博通微电子有限公司', '周涛', '0755-8277-3366', 'sales@botongwei.cn', '深圳市宝安区西乡街道宝源路', 3],
  ['SUP-009', '苏州晶联电子材料有限公司', '吴芳', '0512-6288-7799', 'sales@jinglian-sz.com', '苏州市工业园区星湖街218号', 4],
  ['SUP-010', '广州嘉立创电子科技有限公司', '郑凯', '020-3860-1122', 'pcb@jlc.com', '广州市天河区高普路1023号', 5]
];

// [料号, 名称, 品牌, 型号, 规格, 封装, 单位, 分类index, 生命周期, moq, 交期, 单价, 供应商index, 数量级]
const COMPONENTS = [
  ['R-0603-10K-1', '贴片电阻', 'YAGEO', 'RC0603FR-0710KL', '10KΩ ±1% 1/10W', '0603', 'pcs', 0, 'active', 5000, 5, 0.008, 4, 5000],
  ['R-0603-100R-1', '贴片电阻', 'YAGEO', 'RC0603FR-07100RL', '100Ω ±1% 1/10W', '0603', 'pcs', 0, 'active', 5000, 5, 0.008, 4, 5000],
  ['R-0805-4K7-1', '贴片电阻', 'UNI-ROYAL', '0805W8F4701T5E', '4.7KΩ ±1% 1/8W', '0805', 'pcs', 0, 'active', 5000, 7, 0.012, 0, 5000],
  ['R-1206-0R05-1', '合金采样电阻', 'YAGEO', 'RL1206FR-070R05L', '0.05Ω ±1% 1W', '1206', 'pcs', 0, 'active', 3000, 14, 0.18, 0, 3000],
  ['C-0603-100N-50V', '贴片电容', 'Samsung', 'CL10B104KB8NNNC', '100nF ±10% 50V X7R', '0603', 'pcs', 1, 'active', 4000, 7, 0.014, 4, 4000],
  ['C-0805-10U-25V', '贴片电容', 'Murata', 'GRM21BR61E106KA73L', '10µF ±10% 25V X5R', '0805', 'pcs', 1, 'active', 3000, 10, 0.09, 3, 3000],
  ['C-1210-22U-16V', '贴片电容', 'Taiyo Yuden', 'EMK325BJ226KM-T', '22µF ±10% 16V X5R', '1210', 'pcs', 1, 'active', 2000, 12, 0.32, 3, 2000],
  ['C-AL-470U-35V', '铝电解电容', 'Nichicon', 'UFW1V471MPD', '470µF ±20% 35V', 'D8x11.5', 'pcs', 1, 'nrnd', 500, 21, 0.62, 0, 600],
  ['C-1206-1N-100V', '贴片电容', 'Murata', 'GRM319R72A102KA01D', '1nF ±10% 100V X7R', '1206', 'pcs', 1, 'active', 2000, 10, 0.075, 3, 2000],
  ['L-0603-10N', '贴片电感', 'Murata', 'LQW18AN10NG00D', '10nH ±2% 600mA', '0603', 'pcs', 2, 'active', 4000, 12, 0.045, 3, 4000],
  ['L-PWR-4R7', '功率电感', 'Sunlord', 'SWPA6045S4R7MT', '4.7µH ±20% 3.5A', '6x6x4.5', 'pcs', 2, 'active', 1000, 14, 0.46, 8, 1000],
  ['L-CMC-90R', '共模电感', 'TDK', 'ACM7060-701-2PL', '700Ω @100MHz 4A', '7060', 'pcs', 2, 'active', 800, 21, 1.35, 3, 800],
  ['D-SS34', '肖特基二极管', 'onsemi', 'SS34', '40V 3A SMA', 'SMA', 'pcs', 3, 'active', 3000, 7, 0.11, 4, 3000],
  ['D-SMBJ15CA', 'TVS 二极管', 'Littelfuse', 'SMBJ15CA', '15V 600W 双向', 'SMB', 'pcs', 3, 'active', 2000, 10, 0.28, 3, 2000],
  ['D-LED-0805-R', '贴片 LED', 'Everlight', '17-21SURC/S530-A3', '红色 620-630nm', '0805', 'pcs', 3, 'active', 4000, 10, 0.05, 0, 4000],
  ['Q-2N7002', 'N沟道 MOSFET', 'Nexperia', '2N7002,215', '60V 300mA 1.8Ω', 'SOT-23', 'pcs', 4, 'active', 3000, 10, 0.06, 4, 3000],
  ['Q-SI2301', 'P沟道 MOSFET', 'Vishay', 'SI2301CDS-T1-GE3', '-20V -2.8A', 'SOT-23', 'pcs', 4, 'active', 3000, 14, 0.19, 3, 3000],
  ['Q-S8050', 'NPN 三极管', 'Slkor', 'S8050', '25V 500mA', 'SOT-23', 'pcs', 4, 'active', 5000, 7, 0.03, 7, 5000],
  ['U-STM32F103C8T6', '32位 MCU', 'ST', 'STM32F103C8T6', 'ARM Cortex-M3 72MHz 64KB Flash', 'LQFP-48', 'pcs', 5, 'active', 250, 21, 12.8, 1, 300],
  ['U-STM32G030F6P6', '32位 MCU', 'ST', 'STM32G030F6P6', 'Cortex-M0+ 64MHz 32KB Flash', 'TSSOP-20', 'pcs', 5, 'active', 500, 21, 6.45, 1, 500],
  ['U-ESP32-S3-WROOM', 'WiFi/BLE 模组', 'Espressif', 'ESP32-S3-WROOM-1-N8R8', '8MB Flash 8MB PSRAM', 'SMD-41', 'pcs', 5, 'active', 100, 28, 24.6, 5, 150],
  ['U-AT32F421C8T7', '32位 MCU', 'Artery', 'AT32F421C8T7', 'Cortex-M4 120MHz 64KB', 'LQFP-48', 'pcs', 5, 'active', 250, 21, 7.9, 5, 300],
  ['U-GD32F103C8T6', '32位 MCU', 'GigaDevice', 'GD32F103C8T6', 'Cortex-M3 108MHz 64KB', 'LQFP-48', 'pcs', 5, 'nrnd', 250, 21, 9.2, 2, 300],
  ['M-W25Q128JVSIQ', 'NOR Flash', 'Winbond', 'W25Q128JVSIQ', '128Mbit SPI 133MHz', 'SOP-8', 'pcs', 6, 'active', 500, 21, 4.35, 1, 600],
  ['M-AT24C02C', 'EEPROM', 'Microchip', 'AT24C02C-SSHM-T', '2Kbit I²C 1.7-5.5V', 'SOP-8', 'pcs', 6, 'active', 1000, 21, 0.72, 3, 1000],
  ['M-KLM8G1GETF', 'eMMC', 'Samsung', 'KLM8G1GETF-B041', '8GB eMMC 5.1', 'BGA-153', 'pcs', 6, 'active', 100, 35, 32.5, 5, 150],
  ['M-MT41K512M16', 'DDR3L SDRAM', 'Micron', 'MT41K512M16HA-125 IT:D', '8Gb 1600Mbps', 'FBGA-96', 'pcs', 6, 'eol', 50, 42, 58.0, 5, 80],
  ['CN-PH2-4A', '线对板连接器', 'JST', 'B4B-PH-K-S', '2.0mm 4Pin 直插', 'PH-4P', 'pcs', 7, 'active', 1000, 14, 0.28, 0, 1200],
  ['CN-XH2-6A', '线对板连接器', 'JST', 'B6B-XH-A', '2.5mm 6Pin 直插', 'XH-6P', 'pcs', 7, 'active', 1000, 14, 0.42, 0, 1200],
  ['CN-TYPE-C-16P', 'USB Type-C 座', '正凌', 'TYPE-C-16P-24M', 'USB2.0 16Pin 沉板', 'SMD-16P', 'pcs', 7, 'active', 800, 18, 1.15, 7, 1000],
  ['CN-FFC-30P', 'FFC 连接器', 'Amphenol', 'FFC2B28-30-G', '0.5mm 30Pin 下接', 'SMD-30P', 'pcs', 7, 'active', 1000, 21, 0.86, 3, 1000],
  ['CN-RJ45-8P', 'RJ45 网络接口', 'Wurth', '7499010121A', '10/100Base-T 带变压器', 'THT-8P', 'pcs', 7, 'active', 300, 28, 12.4, 3, 400],
  ['P-AMS1117-3V3', 'LDO 稳压器', '稳先微', 'AMS1117-3.3', '3.3V 1A 低压差', 'SOT-223', 'pcs', 8, 'active', 1000, 7, 0.32, 7, 1200],
  ['P-TPS54331', '降压转换器', 'TI', 'TPS54331DR', '3.5-28V 3A 570kHz', 'SOIC-8', 'pcs', 8, 'active', 500, 21, 3.85, 1, 600],
  ['P-MP1584', '降压转换器', 'MPS', 'MP1584EN', '4.5-28V 3A', 'SOIC-8', 'pcs', 8, 'active', 800, 18, 1.62, 5, 800],
  ['P-TLP291', '光耦隔离器', 'Toshiba', 'TLP291(GB-TP,SE)', '50mA 3750Vrms', 'SOP-4', 'pcs', 8, 'active', 1000, 18, 0.78, 2, 1000],
  ['Y-8M-3225', '无源晶振', 'NDK', 'NX3225SA-8.000000MHZ', '8MHz ±10ppm 8pF', '3225', 'pcs', 9, 'active', 1000, 21, 1.25, 5, 1200],
  ['Y-32K-3215', '晶振', 'EPSON', 'FC-135 32.7680KA-A3', '32.768kHz ±20ppm 12.5pF', '3215', 'pcs', 9, 'active', 1000, 21, 1.05, 5, 1200],
  ['Y-25M-5032', '有源晶振', 'Abracon', 'ASV-25.000MHZ-EJ-T', '25MHz ±20ppm 3.3V', '5032', 'pcs', 9, 'active', 500, 28, 3.2, 3, 600],
  ['S-BMP280', '气压传感器', 'Bosch', 'BMP280', '300-1100hPa I²C/SPI', 'LGA-8', 'pcs', 10, 'active', 300, 28, 8.6, 5, 400],
  ['S-MPU6050', '六轴姿态传感器', 'TDK InvenSense', 'MPU-6050', '3轴陀螺仪+3轴加速度', 'LGA-24', 'pcs', 10, 'nrnd', 200, 35, 6.9, 5, 300],
  ['S-SHT30', '温湿度传感器', 'Sensirion', 'SHT30-DIS-B', '±2%RH ±0.2℃ I²C', 'DFN-8', 'pcs', 10, 'active', 300, 28, 9.4, 3, 400],
  ['PCB-4L-1.6', '四层 PCB 板', '嘉立创', 'FR4-4L-1.6-ENIG', 'FR-4 1.6mm 沉金 100x100', '定制', 'pcs', 11, 'active', 50, 7, 18.5, 9, 120],
  ['ST-SAC305', '无铅焊锡膏', '千住', 'M705-S101-S4', 'SAC305 Type4 500g', '500g/罐', '罐', 11, 'active', 20, 14, 268, 8, 30],
  ['ST-SOLDER-08', '无铅焊锡丝', '千住', 'SAC305-0.8mm', '0.8mm 500g/卷', '500g/卷', '卷', 11, 'active', 20, 14, 195, 8, 30]
];

const BOMS = [
  {
    no: 'BOM-2026-001', name: '智能网关主板', version: 'V1.2', product: 'GW-300 智能网关',
    items: [
      ['U1', '32位 MCU', 'ST', 'STM32F103C8T6', 'LQFP-48', 1, 0.5],
      ['U2', 'WiFi/BLE 模组', 'Espressif', 'ESP32-S3-WROOM-1-N8R8', 'SMD-41', 1, 0.3],
      ['U3', 'NOR Flash', 'Winbond', 'W25Q128JVSIQ', 'SOP-8', 1, 0],
      ['U4', '降压转换器', 'TI', 'TPS54331DR', 'SOIC-8', 2, 0.5],
      ['U5', 'LDO 稳压器', '稳先微', 'AMS1117-3.3', 'SOT-223', 1, 0.5],
      ['U6', 'EEPROM', 'Microchip', 'AT24C02C-SSHM-T', 'SOP-8', 1, 0],
      ['U7', 'RJ45 网络接口', 'Wurth', '7499010121A', 'THT-8P', 1, 0.2],
      ['Y1', '无源晶振', 'NDK', 'NX3225SA-8.000000MHZ', '3225', 1, 0.3],
      ['Y2', '晶振', 'EPSON', 'FC-135 32.7680KA-A3', '3215', 1, 0.3],
      ['R1-R24', '贴片电阻', 'YAGEO', 'RC0603FR-0710KL', '0603', 24, 1.0],
      ['R25-R40', '贴片电阻', 'UNI-ROYAL', '0805W8F4701T5E', '0805', 16, 1.0],
      ['C1-C30', '贴片电容', 'Samsung', 'CL10B104KB8NNNC', '0603', 30, 1.5],
      ['C31-C42', '贴片电容', 'Murata', 'GRM21BR61E106KA73L', '0805', 12, 1.0],
      ['C43-C48', '贴片电容', 'Taiyo Yuden', 'EMK325BJ226KM-T', '1210', 6, 1.0],
      ['L1-L4', '功率电感', 'Sunlord', 'SWPA6045S4R7MT', '6x6x4.5', 4, 0.5],
      ['D1-D8', '肖特基二极管', 'onsemi', 'SS34', 'SMA', 8, 0.8],
      ['D9-D14', 'TVS 二极管', 'Littelfuse', 'SMBJ15CA', 'SMB', 6, 0.8],
      ['D15-D20', '贴片 LED', 'Everlight', '17-21SURC/S530-A3', '0805', 6, 1.0],
      ['Q1-Q10', 'N沟道 MOSFET', 'Nexperia', '2N7002,215', 'SOT-23', 10, 0.8],
      ['J1-J2', 'USB Type-C 座', '正凌', 'TYPE-C-16P-24M', 'SMD-16P', 2, 0.5],
      ['J3', 'FFC 连接器', 'Amphenol', 'FFC2B28-30-G', 'SMD-30P', 1, 0.3],
      ['J4-J5', '线对板连接器', 'JST', 'B4B-PH-K-S', 'PH-4P', 2, 0.5],
      ['PCB1', '四层 PCB 板', '嘉立创', 'FR4-4L-1.6-ENIG', '定制', 1, 0.2]
    ]
  },
  {
    no: 'BOM-2026-002', name: '电源管理模块', version: 'V2.0', product: 'PM-120 电源模块',
    items: [
      ['U1', '降压转换器', 'MPS', 'MP1584EN', 'SOIC-8', 2, 0.5],
      ['U2', '降压转换器', 'TI', 'TPS54331DR', 'SOIC-8', 1, 0.5],
      ['U3', '光耦隔离器', 'Toshiba', 'TLP291(GB-TP,SE)', 'SOP-4', 2, 0.5],
      ['U4', 'LDO 稳压器', '稳先微', 'AMS1117-3.3', 'SOT-223', 2, 0.5],
      ['L1-L2', '共模电感', 'TDK', 'ACM7060-701-2PL', '7060', 2, 0.5],
      ['D1-D4', '肖特基二极管', 'onsemi', 'SS34', 'SMA', 4, 0.8],
      ['D5-D8', 'TVS 二极管', 'Littelfuse', 'SMBJ15CA', 'SMB', 4, 0.8],
      ['R1-R12', '合金采样电阻', 'YAGEO', 'RL1206FR-070R05L', '1206', 4, 1.0],
      ['R13-R20', '贴片电阻', 'YAGEO', 'RC0603FR-0710KL', '0603', 8, 1.0],
      ['C1-C16', '贴片电容', 'Murata', 'GRM319R72A102KA01D', '1206', 16, 1.2],
      ['C17-C22', '铝电解电容', 'Nichicon', 'UFW1V471MPD', 'D8x11.5', 6, 1.0],
      ['C23-C30', '贴片电容', 'Samsung', 'CL10B104KB8NNNC', '0603', 8, 1.5],
      ['Q1-Q6', 'P沟道 MOSFET', 'Vishay', 'SI2301CDS-T1-GE3', 'SOT-23', 6, 0.8],
      ['J1-J2', '线对板连接器', 'JST', 'B6B-XH-A', 'XH-6P', 2, 0.5],
      ['PCB1', '四层 PCB 板', '嘉立创', 'FR4-4L-1.6-ENIG', '定制', 1, 0.2]
    ]
  },
  {
    no: 'BOM-2026-003', name: '环境监测终端', version: 'V1.0', product: 'ENV-20 环境终端',
    items: [
      ['U1', '32位 MCU', 'Artery', 'AT32F421C8T7', 'LQFP-48', 1, 0.5],
      ['U2', '温湿度传感器', 'Sensirion', 'SHT30-DIS-B', 'DFN-8', 1, 0.5],
      ['U3', '气压传感器', 'Bosch', 'BMP280', 'LGA-8', 1, 0.5],
      ['U4', '六轴姿态传感器', 'TDK InvenSense', 'MPU-6050', 'LGA-24', 1, 0.5],
      ['U5', 'NOR Flash', 'Winbond', 'W25Q128JVSIQ', 'SOP-8', 1, 0],
      ['U6', 'LDO 稳压器', '稳先微', 'AMS1117-3.3', 'SOT-223', 1, 0.5],
      ['U7', '有源晶振', 'Abracon', 'ASV-25.000MHZ-EJ-T', '5032', 1, 0.3],
      ['U8', 'NPN 三极管', 'Slkor', 'S8050', 'SOT-23', 2, 0.8],
      ['R1-R8', '贴片电阻', 'YAGEO', 'RC0603FR-07100RL', '0603', 8, 1.0],
      ['C1-C10', '贴片电容', 'Samsung', 'CL10B104KB8NNNC', '0603', 10, 1.5],
      ['C11-C14', '贴片电容', 'Murata', 'GRM21BR61E106KA73L', '0805', 4, 1.0],
      ['D1-D2', '贴片 LED', 'Everlight', '17-21SURC/S530-A3', '0805', 2, 1.0],
      ['J1', 'USB Type-C 座', '正凌', 'TYPE-C-16P-24M', 'SMD-16P', 1, 0.5],
      ['J2', '线对板连接器', 'JST', 'B4B-PH-K-S', 'PH-4P', 1, 0.5],
      ['PCB1', '四层 PCB 板', '嘉立创', 'FR4-4L-1.6-ENIG', '定制', 1, 0.2]
    ]
  }
];

// 未匹配行（用于演示 BOM 兜底建档）
const EXTRA_UNMATCHED = [
  ['U9', '蓝牙模组', 'Nordic', 'nRF52832-QFAA-R', 'BLE 5.0 Cortex-M4', 'QFN-48', 1, 0.3],
  ['U10', '电流检测放大器', 'TI', 'INA180A2IDBVR', '26V 带宽 350kHz', 'SOT-23-5', 2, 0.5]
];

async function main() {
  const EMPTY = process.argv.includes('--empty');
  const conn = await mysql.createConnection(DB);
  console.log('→ 连接数据库成功');

  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('→ 表结构创建完成');

  // ---------- 用户 ----------
  const hash = bcrypt.hashSync('123456', 10);
  const users = EMPTY
    ? [
      ['superadmin', hash, '系统管理员', 'super_admin', '信息中心', null, null],
      ['admin', hash, '管理员', 'admin', '供应链部', null, null],
      ['employee', hash, '员工', 'employee', '生产部', null, null]
    ]
    : [
      ['superadmin', hash, '林致远', 'super_admin', '信息中心', 'superadmin@qjcrk.com', '13800000001'],
      ['admin', hash, '周敏', 'admin', '供应链部', 'admin@qjcrk.com', '13800000002'],
      ['employee', hash, '陈晓峰', 'employee', '生产部', 'employee@qjcrk.com', '13800000003'],
      ['liuyang', hash, '刘洋', 'employee', '仓储部', 'liuyang@qjcrk.com', '13800000004'],
      ['wangqian', hash, '王倩', 'employee', '研发部', 'wangqian@qjcrk.com', '13800000005']
    ];
  await conn.query(
    'INSERT INTO sys_user (username,password_hash,real_name,role,dept,email,phone) VALUES ?', [users]
  );

  // ---------- 分类 ----------
  await conn.query('INSERT INTO category (name,code,sort) VALUES ?',
    [CATEGORIES.map((c, i) => [c[0], c[1], i + 1])]);

  if (EMPTY) {
    console.log('→ 空库模式：已创建表结构、3 个角色账号与 ' + CATEGORIES.length + ' 个基础分类');
    console.log('  登录账号：superadmin / admin / employee，初始密码均为 123456');
    console.log('  请首次登录后立即修改密码，并按实际人员调整账号');
    await conn.end();
    return;
  }

  // ---------- 供应商 ----------
  await conn.query(
    'INSERT INTO supplier (code,name,contact,phone,email,address,rating) VALUES ?', [SUPPLIERS]
  );

  // ---------- 器件 ----------
  const compRows = COMPONENTS.map((c, i) => {
    const [pn, name, brand, model, spec, pkg, unit, catIdx, life, moq, lead] = c;
    return [pn, name, brand, model, spec, pkg, unit, catIdx + 1, life, 0, moq, lead,
      `${pn} 规格书`, '—', 1];
  });
  await conn.query(
    `INSERT INTO component
     (part_number,name,brand,model,spec,package,unit,category_id,lifecycle,min_stock,moq,lead_time_days,datasheet_url,remark,status)
     VALUES ?`, [compRows]
  );

  const [compDb] = await conn.query('SELECT id, part_number, brand, model, unit FROM component ORDER BY id');
  const compByPart = new Map(compDb.map(c => [c.part_number, c]));

  // ---------- 器件-供应商 ----------
  const csRows = [];
  COMPONENTS.forEach((c, i) => {
    const comp = compByPart.get(c[0]);
    const mainSup = c[12] + 1;
    csRows.push([comp.id, mainSup, `${c[2]}-${c[3]}`, c[11], c[9], c[10], 1]);
    // 30% 器件有第二供应商
    if (i % 3 === 0) {
      const alt = (mainSup % 10) + 1;
      csRows.push([comp.id, alt, `${c[2]}-${c[3]}-ALT`, Number((c[11] * 1.08).toFixed(4)), c[9], c[10] + 3, 0]);
    }
  });
  await conn.query(
    'INSERT INTO component_supplier (component_id,supplier_id,supplier_part_no,price,moq,lead_time_days,is_primary) VALUES ?',
    [csRows]
  );

  // ---------- 替代料 ----------
  const subPairs = [
    ['U-STM32F103C8T6', 'U-GD32F103C8T6', 'conditional', '主频与 Flash 一致，需验证 USB 时序'],
    ['U-STM32F103C8T6', 'U-AT32F421C8T7', 'conditional', '引脚兼容，需重新评估固件'],
    ['U-STM32G030F6P6', 'U-AT32F421C8T7', 'conditional', '封装不同，需改板'],
    ['C-0805-10U-25V', 'C-1210-22U-16V', 'conditional', '容值/耐压不同，需降额评估'],
    ['R-0603-10K-1', 'R-0805-4K7-1', 'conditional', '阻值不同，仅限分压网络调整'],
    ['P-TPS54331', 'P-MP1584', 'full', '同为 3A 降压，需调整反馈电阻'],
    ['M-W25Q128JVSIQ', 'M-KLM8G1GETF', 'conditional', '容量差异大，仅应急'],
    ['D-SS34', 'D-SMBJ15CA', 'conditional', 'TVS 不可直接替代整流管，仅应急验证'],
    ['U-ESP32-S3-WROOM', 'U-AT32F421C8T7', 'conditional', '无无线功能，仅主控应急']
  ];
  const subRows = subPairs.map(([a, b, t, r]) => [compByPart.get(a).id, compByPart.get(b).id, t, r]);
  await conn.query(
    'INSERT INTO component_substitute (component_id,substitute_id,type,remark) VALUES ?', [subRows]
  );

  // ---------- 库存 / 批次 / 流水 ----------
  const operatorIds = [1, 2, 3, 4];
  const stockRows = [];
  const batchRows = [];
  const txRows = [];
  const minStockMap = new Map();
  const zeroOutParts = new Set(['M-MT41K512M16', 'C-AL-470U-35V', 'S-MPU6050', 'Y-25M-5032']);
  let txSeq = 0;

  for (let ci = 0; ci < COMPONENTS.length; ci++) {
    const c = COMPONENTS[ci];
    const comp = compByPart.get(c[0]);
    const scale = c[13];
    const price = c[11];
    let balance = Math.round(scale * (0.4 + rnd() * 1.6));
    const events = [];
    const inOnly = ci % 9 === 4; // 少量器件 90 天内无出库，用于呆滞料分析
    const n = randInt(7, 15);
    for (let k = 0; k < n; k++) {
      const daysAgo = randInt(0, 90);
      const at = notFuture(dayAgo(daysAgo));
      at.setHours(randInt(8, 18), randInt(0, 59), randInt(0, 59));
      notFuture(at);
      const isIn = inOnly ? true : rnd() < 0.4;
      if (isIn) {
        const q = Math.round(scale * (0.15 + rnd() * 0.5));
        if (q <= 0) continue;
        balance += q;
        events.push({ type: 'in', qty: q, at });
      } else if (balance > 0) {
        // 保留安全余量，避免除刻意清零外出现意外零库存
        const floorQty = zeroOutParts.has(c[0]) ? 0 : Math.max(1, Math.round(scale * 0.05));
        const maxOut = balance - floorQty;
        if (maxOut <= 0) continue;
        const q = Math.max(1, Math.min(maxOut, Math.round(scale * (0.05 + rnd() * 0.18))));
        balance -= q;
        events.push({ type: 'out', qty: -q, at });
      }
    }
    if (zeroOutParts.has(c[0]) && balance > 0) {
      const at = dayAgo(randInt(2, 9));
      at.setHours(randInt(9, 17), randInt(0, 59), 0);
      notFuture(at);
      events.push({ type: 'out', qty: -balance, at });
      balance = 0;
    }
    events.sort((a, b) => a.at - b.at);

    const isZero = balance <= 0;
    // 安全库存：约 20% 器件高于现有库存 → 预警
    let minStock;
    if (isZero) minStock = Math.round(scale * (0.15 + rnd() * 0.2));
    else if (ci % 5 === 0) minStock = Math.round(balance * (1.35 + rnd() * 0.6));
    else minStock = Math.round(balance * (0.15 + rnd() * 0.35));

    const avgPrice = Number((price * (0.96 + rnd() * 0.1)).toFixed(4));
    stockRows.push([comp.id, balance, 0, 0, avgPrice]);
    minStockMap.set(comp.id, minStock);

    // 批次
    if (balance > 0) {
      const parts = balance > 1000 ? 3 : balance > 300 ? 2 : 1;
      let left = balance;
      for (let b = 0; b < parts; b++) {
        const q = b === parts - 1 ? left : Math.max(1, Math.round(balance / parts * (0.8 + rnd() * 0.4)));
        left -= q;
        const bd = dayAgo(randInt(10, 200));
        batchRows.push([
          comp.id,
          `B${String(bd.getFullYear()).slice(2)}${pad(bd.getMonth() + 1, 2)}${pad(randInt(1, 28), 2)}-${pad(randInt(1, 9), 2)}`,
          q, avgPrice, `A-${pad(randInt(1, 12), 2)}-${pad(randInt(1, 8), 2)}`,
          c[12] + 1, rnd() < 0.25 ? dstr(new Date(Date.now() + randInt(60, 400) * 86400000)).slice(0, 10) : null, 1
        ]);
      }
    }

    // 流水：从最终结存倒推每笔的 before / after
    let running = balance;
    const rev = [...events].reverse();
    const withBefore = [];
    for (const e of rev) {
      withBefore.unshift({ ...e, after: running, before: running - e.qty });
      running -= e.qty;
    }
    for (const e of withBefore) {
      const seq = ++txSeq;
      const isIn = e.type === 'in';
      txRows.push([
        comp.id, e.type, e.qty, e.before, e.after,
        isIn ? 'inbound' : 'outbound',
        null,
        `${isIn ? 'IN' : 'OUT'}${dstr(e.at).slice(0, 10).replace(/-/g, '')}${pad(seq % 9999)}`,
        null, `A-${pad(randInt(1, 12), 2)}-${pad(randInt(1, 8), 2)}`,
        pick(operatorIds),
        isIn ? '采购到货入库' : '生产领料出库',
        dstr(e.at)
      ]);
    }
  }
  await conn.query('INSERT INTO stock (component_id,quantity,reserved,in_transit,avg_price) VALUES ?', [stockRows]);
  if (batchRows.length) {
    await conn.query(
      'INSERT INTO stock_batch (component_id,batch_no,quantity,unit_price,location,supplier_id,expiry_date,status) VALUES ?',
      [batchRows]
    );
  }
  await conn.query(
    `INSERT INTO stock_transaction
     (component_id,type,quantity,before_qty,after_qty,ref_type,ref_id,ref_no,batch_no,location,operator_id,remark,created_at)
     VALUES ?`, [txRows]
  );
  await conn.query('UPDATE component c JOIN stock s ON s.component_id=c.id SET c.min_stock=GREATEST(c.min_stock,0)');
  for (const [cid, ms] of minStockMap) {
    await conn.query('UPDATE component SET min_stock=? WHERE id=?', [ms, cid]);
  }

  // ---------- BOM ----------
  const allComps = compDb;
  const byBrandModel = new Map(allComps.map(c => [`${(c.brand || '').toLowerCase()}|${(c.model || '').toLowerCase()}`, c]));
  const byModel = new Map(allComps.map(c => [(c.model || '').toLowerCase(), c]));

  const bomIds = [];
  for (const b of BOMS) {
    const [r] = await conn.query(
      'INSERT INTO bom (bom_no,name,version,product_name,remark,created_by) VALUES (?,?,?,?,?,?)',
      [b.no, b.name, b.version, b.product, '由 Excel 导入并自动匹配器件档案', 1]
    );
    bomIds.push(r.insertId);
    const items = [];
    for (const it of b.items) {
      const [ref, name, brand, model, pkg, qty, loss] = it;
      const key = `${brand.toLowerCase()}|${model.toLowerCase()}`;
      let matched = byBrandModel.get(key) || byModel.get(model.toLowerCase());
      items.push([
        r.insertId, matched ? matched.id : null, ref, name, brand, model, '', pkg,
        qty, loss, 'pcs', matched ? (byBrandModel.has(key) ? 'exact' : 'model_only') : 'unmatched', ''
      ]);
    }
    for (const it of EXTRA_UNMATCHED) {
      const [ref, name, brand, model, spec, pkg, qty, loss] = it;
      items.push([r.insertId, null, ref, name, brand, model, spec, pkg, qty, loss, 'pcs', 'unmatched', '系统无档案']);
    }
    await conn.query(
      `INSERT INTO bom_item
       (bom_id,component_id,ref_des,name,brand,model,spec,package,qty_per_unit,loss_rate,unit,match_type,remark)
       VALUES ?`, [items]
    );
  }

  // ---------- 分析快照（BOM1 / 300台）----------
  const planQty = 800;
  const [bi] = await conn.query(
    `SELECT bi.*, c.part_number, c.brand AS c_brand, c.model AS c_model,
            COALESCE(s.quantity,0) stock_qty, COALESCE(s.reserved,0) reserved, COALESCE(s.in_transit,0) in_transit
     FROM bom_item bi LEFT JOIN component c ON bi.component_id=c.id
     LEFT JOIN stock s ON s.component_id=c.id WHERE bi.bom_id=?`, [bomIds[0]]
  );
  const analysisRows = [];
  for (const it of bi) {
    const required = Math.ceil(it.qty_per_unit * planQty * (1 + Number(it.loss_rate || 0) / 100));
    const available = Number(it.stock_qty) - Number(it.reserved) + Number(it.in_transit);
    let shortage = Math.max(0, required - available);
    let status = !it.component_id ? 'unmatched' : shortage > 0 ? 'shortage' : 'ok';
    let substitute = null;
    if (shortage > 0 && it.component_id) {
      const [subs] = await conn.query(
        `SELECT c2.id, c2.part_number, c2.model,
                COALESCE(s2.quantity,0)-COALESCE(s2.reserved,0)+COALESCE(s2.in_transit,0) avail
         FROM component_substitute cs JOIN component c2 ON c2.id=cs.substitute_id
         LEFT JOIN stock s2 ON s2.component_id=c2.id WHERE cs.component_id=?`, [it.component_id]
      );
      const cover = subs.reduce((a, s) => a + Math.max(0, Number(s.avail)), 0);
      if (cover > 0) {
        const finalShortage = Math.max(0, shortage - cover);
        substitute = { subs, coverQty: Math.min(shortage, cover) };
        status = finalShortage === 0 ? 'substitute' : 'shortage';
        shortage = finalShortage;
      }
    }
    analysisRows.push({
      component_id: it.component_id, ref_des: it.ref_des, name: it.name, brand: it.brand,
      model: it.model, part_number: it.part_number, package: it.package,
      qty_per_unit: Number(it.qty_per_unit), loss_rate: Number(it.loss_rate),
      required, stock_qty: Number(it.stock_qty), reserved: Number(it.reserved),
      in_transit: Number(it.in_transit), available, shortage, status, substitute
    });
  }
  const summary = {
    total: analysisRows.length,
    ok: analysisRows.filter(r => r.status === 'ok').length,
    shortage: analysisRows.filter(r => r.status === 'shortage').length,
    substitute: analysisRows.filter(r => r.status === 'substitute').length,
    unmatched: analysisRows.filter(r => r.status === 'unmatched').length
  };
  const [baIns] = await conn.query(
    `INSERT INTO bom_analysis
     (bom_id,plan_qty,file_name,total_items,matched_items,shortage_items,ok_items,substitute_items,unmatched_items,result,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [bomIds[0], planQty, 'GW300_BOM_V1.2.xlsx', summary.total, summary.total - summary.unmatched,
      summary.shortage + summary.substitute, summary.ok, summary.substitute, summary.unmatched,
      JSON.stringify(analysisRows), 1, dstr(dayAgo(3))]
  );
  const analysisId = baIns.insertId;

  // ---------- 采购申请 ----------
  const shortageRows = analysisRows.filter(r => r.shortage > 0 && r.component_id);
  const [pr1] = await conn.query(
    `INSERT INTO purchase_request (request_no,source,bom_analysis_id,title,status,applicant_id,remark,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['PR20261027001', 'bom_analysis', analysisId, 'GW-300 智能网关主板缺料补货', 'pending', 3,
      `由 BOM 分析自动生成，计划生产 ${planQty} 台`, dstr(dayAgo(3))]
  );
  if (shortageRows.length) {
    await conn.query(
      'INSERT INTO purchase_request_item (request_id,component_id,quantity,remark) VALUES ?',
      [shortageRows.slice(0, 8).map(r => [pr1.insertId, r.component_id, r.shortage, `缺口 ${r.shortage}`])]
    );
  }
  const [pr2] = await conn.query(
    `INSERT INTO purchase_request (request_no,source,title,status,applicant_id,approver_id,approved_at,approve_remark,remark,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['PR20261022002', 'manual', '常用阻容件月度备货', 'approved', 4, 2, dstr(dayAgo(6)), '同意，按季度用量备货', '常规备料', dstr(dayAgo(7))]
  );
  const r0603 = compByPart.get('R-0603-10K-1');
  const c0603 = compByPart.get('C-0603-100N-50V');
  const q2n = compByPart.get('Q-2N7002');
  await conn.query('INSERT INTO purchase_request_item (request_id,component_id,quantity,remark) VALUES ?',
    [[[pr2.insertId, r0603.id, 20000, '安全库存补充'], [pr2.insertId, c0603.id, 16000, ''], [pr2.insertId, q2n.id, 8000, '']]]);
  await conn.query(
    `INSERT INTO purchase_request (request_no,source,title,status,applicant_id,remark,created_at)
     VALUES (?,?,?,?,?,?,?)`,
    ['PR20261029003', 'manual', '研发试产样片申请', 'draft', 5, 'ENV-20 试产 50 台', dstr(dayAgo(1))]
  );

  // ---------- 采购订单 ----------
  const poData = [
    ['PO20261020001', 1, pr2.insertId, 'sent', 0, 7, dstr(dayAgo(9)), '已下发，等待供应商发货'],
    ['PO20261015002', 5, null, 'partial', 0, 21, dstr(dayAgo(14)), '部分到货，剩余在途'],
    ['PO20261008003', 3, null, 'received', 0, 5, dstr(dayAgo(21)), '已全部到货']
  ];
  const poIds = [];
  for (const p of poData) {
    const [r] = await conn.query(
      `INSERT INTO purchase_order (order_no,supplier_id,request_id,status,total_amount,expected_date,created_by,sent_at,remark,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [p[0], p[1], p[2], p[3], 0, dstr(new Date(Date.now() + p[5] * 86400000)).slice(0, 10), 2, p[6], p[7], p[6]]
    );
    poIds.push(r.insertId);
  }
  const poItems = [
    [poIds[0], r0603.id, 20000, 0, 0.0078],
    [poIds[0], c0603.id, 16000, 0, 0.0135],
    [poIds[0], q2n.id, 8000, 0, 0.058],
    [poIds[1], compByPart.get('U-STM32F103C8T6').id, 500, 200, 12.6],
    [poIds[1], compByPart.get('U-ESP32-S3-WROOM').id, 200, 0, 24.2],
    [poIds[1], compByPart.get('M-W25Q128JVSIQ').id, 1000, 1000, 4.2],
    [poIds[2], compByPart.get('C-0805-10U-25V').id, 10000, 10000, 0.088],
    [poIds[2], compByPart.get('D-SS34').id, 12000, 12000, 0.105]
  ];
  await conn.query(
    'INSERT INTO purchase_order_item (order_id,component_id,quantity,received_qty,unit_price) VALUES ?', [poItems]
  );
  for (const oid of poIds) {
    const [items] = await conn.query('SELECT quantity,unit_price FROM purchase_order_item WHERE order_id=?', [oid]);
    const total = items.reduce((a, i) => a + Number(i.quantity) * Number(i.unit_price), 0);
    await conn.query('UPDATE purchase_order SET total_amount=? WHERE id=?', [total.toFixed(2), oid]);
  }
  // 在途：sent / partial 未到货部分
  for (const it of poItems) {
    if (it[2] - it[3] > 0 && (it[0] === poIds[0] || it[0] === poIds[1])) {
      await conn.query('UPDATE stock SET in_transit = in_transit + ? WHERE component_id=?', [it[2] - it[3], it[1]]);
    }
  }

  // 历史采购订单（用于供应商采购额与月度趋势报表）
  for (let i = 0; i < 18; i++) {
    const at = dayAgo(randInt(30, 190));
    at.setHours(randInt(9, 18), randInt(0, 59), 0);
    const no = `PO${dstr(at).slice(0, 10).replace(/-/g, '')}${pad(800 + i, 4)}`;
    const sup = (i % 10) + 1;
    const comp = pick(compDb);
    const qty = randInt(2, 40) * 50;
    const compRow = COMPONENTS.find(c => c[0] === comp.part_number);
    const price = Number(((compRow ? compRow[11] : 1) * (0.95 + rnd() * 0.15)).toFixed(4));
    const amount = Number((qty * price).toFixed(2));
    const [r] = await conn.query(
      `INSERT INTO purchase_order (order_no,supplier_id,status,total_amount,expected_date,created_by,sent_at,remark,created_at)
       VALUES (?,?,'received',?,?,?,?,?,?)`,
      [no, sup, amount, dstr(new Date(at.getTime() + 14 * 86400000)).slice(0, 10), 2, dstr(at), '历史采购订单', dstr(at)]
    );
    await conn.query(
      `INSERT INTO purchase_order_item (order_id,component_id,quantity,received_qty,unit_price)
       VALUES (?,?,?,?,?)`, [r.insertId, comp.id, qty, qty, price]
    );
  }

  // ---------- 入库单 ----------
  const inboundData = [
    ['IN202610280001', 'purchase', 3, 3, 'confirmed', 3, '采购到货，质检合格'],
    ['IN202610250002', 'return', null, 3, 'confirmed', 3, '生产退料，外观完好'],
    ['IN202610300003', 'purchase', 2, 5, 'draft', 3, '等待质检确认']
  ];
  const inIds = [];
  for (const d of inboundData) {
    const [r] = await conn.query(
      `INSERT INTO inbound_order (order_no,type,purchase_order_id,supplier_id,status,total_qty,total_amount,operator_id,confirmed_by,confirmed_at,remark,created_at)
       VALUES (?,?,?,?,?,0,0,?,?,?,?,?)`,
      [d[0], d[1], d[2], d[3], d[4], d[5], d[4] === 'confirmed' ? 2 : null,
        d[4] === 'confirmed' ? dstr(dayAgo(2)) : null, d[6], dstr(dayAgo(3))]
    );
    inIds.push(r.insertId);
  }
  const inboundItems = [
    [inIds[0], compByPart.get('C-0805-10U-25V').id, 10000, 0.088, 'B260915-01', 'A-03-02', null],
    [inIds[0], compByPart.get('D-SS34').id, 12000, 0.105, 'B260918-02', 'A-04-01', null],
    [inIds[1], compByPart.get('U-STM32F103C8T6').id, 40, 12.8, 'B260710-01', 'A-06-03', null],
    [inIds[2], compByPart.get('U-STM32F103C8T6').id, 300, 12.6, 'B261020-01', 'A-06-03', null],
    [inIds[2], compByPart.get('U-ESP32-S3-WROOM').id, 200, 24.2, 'B261022-01', 'A-06-05', null]
  ];
  await conn.query(
    'INSERT INTO inbound_order_item (order_id,component_id,quantity,unit_price,batch_no,location,expiry_date) VALUES ?',
    [inboundItems]
  );
  for (const id of inIds) {
    const [items] = await conn.query('SELECT quantity,unit_price FROM inbound_order_item WHERE order_id=?', [id]);
    await conn.query('UPDATE inbound_order SET total_qty=?, total_amount=? WHERE id=?',
      [items.reduce((a, i) => a + Number(i.quantity), 0), items.reduce((a, i) => a + Number(i.quantity) * Number(i.unit_price), 0).toFixed(2), id]);
  }

  // ---------- 出库单 ----------
  const outboundData = [
    ['OUT202610290001', 'production', bomIds[0], 'GW-300 首批试产', 'pending', 3, '试产领料 50 台'],
    ['OUT202610260002', 'production', bomIds[2], 'ENV-20 小批量', 'confirmed', 4, '已完成领料'],
    ['OUT202610180003', 'borrow', null, '研发部样机调试', 'confirmed', 5, '借用 15 天，需归还'],
    ['OUT202610300004', 'scrap', null, '来料不良报废', 'draft', 3, 'IQC 判定报废'],
    ['OUT202610120005', 'production', bomIds[1], 'PM-120 返工', 'cancelled', 4, '计划取消']
  ];
  const outIds = [];
  for (const d of outboundData) {
    const [r] = await conn.query(
      `INSERT INTO outbound_order (order_no,type,bom_id,project,status,total_qty,operator_id,confirmed_by,confirmed_at,remark,created_at)
       VALUES (?,?,?,?,?,0,?,?,?,?,?)`,
      [d[0], d[1], d[2], d[3], d[4], d[5], d[4] === 'confirmed' ? 2 : null,
        d[4] === 'confirmed' ? dstr(dayAgo(4)) : null, d[6], dstr(dayAgo(5))]
    );
    outIds.push(r.insertId);
  }
  const outboundItems = [
    [outIds[0], compByPart.get('U-STM32F103C8T6').id, 50, 'GW-300 试产'],
    [outIds[0], compByPart.get('C-0603-100N-50V').id, 1600, 'GW-300 试产'],
    [outIds[0], compByPart.get('R-0603-10K-1').id, 1300, 'GW-300 试产'],
    [outIds[1], compByPart.get('U-AT32F421C8T7').id, 120, 'ENV-20'],
    [outIds[1], compByPart.get('S-SHT30').id, 120, 'ENV-20'],
    [outIds[2], compByPart.get('U-ESP32-S3-WROOM').id, 5, '研发样机'],
    [outIds[2], compByPart.get('S-MPU6050').id, 5, '研发样机'],
    [outIds[3], compByPart.get('CN-TYPE-C-16P').id, 30, '来料不良'],
    [outIds[4], compByPart.get('P-MP1584').id, 100, '返工']
  ];
  await conn.query(
    'INSERT INTO outbound_order_item (order_id,component_id,quantity,purpose) VALUES ?', [outboundItems]
  );
  for (const id of outIds) {
    const [items] = await conn.query('SELECT quantity FROM outbound_order_item WHERE order_id=?', [id]);
    await conn.query('UPDATE outbound_order SET total_qty=? WHERE id=?',
      [items.reduce((a, i) => a + Number(i.quantity), 0), id]);
  }
  // 待出库单占用预留
  for (const it of outboundItems.filter(x => x[0] === outIds[0])) {
    await conn.query('UPDATE stock SET reserved = reserved + ? WHERE component_id=?', [it[2], it[1]]);
  }

  // ---------- 盘点 ----------
  const [chk] = await conn.query(
    `INSERT INTO stock_check (check_no,scope,status,operator_id,item_count,diff_count,remark,created_at,finished_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['CK20261020001', 'A区阻容件', 'done', 4, 0, 0, '月度循环盘点', dstr(dayAgo(10)), dstr(dayAgo(9))]
  );
  const checkComps = ['R-0603-10K-1', 'R-0603-100R-1', 'C-0603-100N-50V', 'C-0805-10U-25V', 'L-0603-10N', 'D-SS34'];
  const checkRows = [];
  let diffCount = 0;
  for (const pn of checkComps) {
    const comp = compByPart.get(pn);
    const [[st]] = await conn.query('SELECT quantity FROM stock WHERE component_id=?', [comp.id]);
    const book = Number(st.quantity);
    const actual = book + (rnd() < 0.4 ? randInt(-40, 40) : 0);
    const diff = actual - book;
    if (diff !== 0) diffCount++;
    checkRows.push([chk.insertId, comp.id, null, book, actual, diff]);
  }
  await conn.query('INSERT INTO stock_check_item (check_id,component_id,batch_no,book_qty,actual_qty,diff_qty) VALUES ?', [checkRows]);
  await conn.query('UPDATE stock_check SET item_count=?, diff_count=? WHERE id=?', [checkRows.length, diffCount, chk.insertId]);
  await conn.query(
    `INSERT INTO stock_check (check_no,scope,status,operator_id,item_count,diff_count,remark,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['CK20261029002', 'B区芯片类', 'in_progress', 3, 0, 0, '季度全盘（进行中）', dstr(dayAgo(1))]
  );

  // ---------- 操作日志 ----------
  const logTpl = [
    ['auth', '登录', '用户登录系统'],
    ['component', '新增', '新增器件档案 R-0603-10K-1'],
    ['component', '导入', 'Excel 批量导入器件 46 条，成功 46 条'],
    ['stock', '确认入库', '入库单 IN202610280001 确认，共 2 项'],
    ['stock', '确认出库', '出库单 OUT202610260002 确认，共 2 项'],
    ['bom', '导入', '导入 BOM-2026-001 智能网关主板 V1.2'],
    ['bom', '缺料分析', 'BOM-2026-001 按 300 台分析，缺料 9 项'],
    ['purchase', '创建申请', '由缺料分析生成采购申请 PR20261027001'],
    ['purchase', '审批', '采购申请 PR20261022002 审批通过'],
    ['purchase', '下发订单', '采购订单 PO20261020001 已下发'],
    ['system', '修改用户', '重置用户 liuyang 的登录密码'],
    ['stock', '盘点', '盘点单 CK20261020001 完成，差异 3 项']
  ];
  const logs = [];
  for (let i = 0; i < 36; i++) {
    const t = logTpl[i % logTpl.length];
    const at = dayAgo(randInt(0, 14));
    at.setHours(randInt(8, 19), randInt(0, 59), randInt(0, 59));
    notFuture(at);
    const uid = randInt(1, 5);
    logs.push([uid, ['superadmin', 'admin', 'employee', 'liuyang', 'wangqian'][uid - 1],
      t[0], t[1], t[2], '192.168.1.' + randInt(10, 200), dstr(at)]);
  }
  await conn.query(
    'INSERT INTO operation_log (user_id,username,module,action,detail,ip,created_at) VALUES ?', [logs]
  );

  const [[cnt]] = await conn.query('SELECT COUNT(*) c FROM component');
  const [[tx]] = await conn.query('SELECT COUNT(*) c FROM stock_transaction');
  console.log(`→ 初始化完成：用户 5 / 器件 ${cnt.c} / 流水 ${tx.c}`);
  await conn.end();
}

main().catch(e => {
  console.error('初始化失败：', e);
  process.exit(1);
});
