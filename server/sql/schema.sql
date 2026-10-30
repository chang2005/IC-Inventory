-- ============================================================
--  电子元器件采购出入库系统  qjcrk
--  MySQL 8.0 / InnoDB / utf8mb4
-- ============================================================
CREATE DATABASE IF NOT EXISTS qjcrk
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qjcrk;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS stock_check_item;
DROP TABLE IF EXISTS stock_check;
DROP TABLE IF EXISTS outbound_order_item;
DROP TABLE IF EXISTS outbound_order;
DROP TABLE IF EXISTS inbound_order_item;
DROP TABLE IF EXISTS inbound_order;
DROP TABLE IF EXISTS purchase_order_item;
DROP TABLE IF EXISTS purchase_order;
DROP TABLE IF EXISTS purchase_request_item;
DROP TABLE IF EXISTS purchase_request;
DROP TABLE IF EXISTS bom_analysis;
DROP TABLE IF EXISTS bom_item;
DROP TABLE IF EXISTS bom;
DROP TABLE IF EXISTS stock_transaction;
DROP TABLE IF EXISTS stock_batch;
DROP TABLE IF EXISTS stock;
DROP TABLE IF EXISTS component_supplier;
DROP TABLE IF EXISTS component_substitute;
DROP TABLE IF EXISTS component;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS supplier;
DROP TABLE IF EXISTS operation_log;
DROP TABLE IF EXISTS sys_user;
SET FOREIGN_KEY_CHECKS = 1;

-- ==================== 系统模块 ====================
CREATE TABLE sys_user (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE COMMENT '登录账号',
  password_hash VARCHAR(255) NOT NULL,
  real_name     VARCHAR(50)  COMMENT '姓名',
  role          ENUM('super_admin','admin','employee') NOT NULL DEFAULT 'employee' COMMENT '超级管理员/管理员/员工',
  dept          VARCHAR(50)  COMMENT '部门',
  email         VARCHAR(100),
  phone         VARCHAR(20),
  status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  last_login_at DATETIME,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='系统用户';

CREATE TABLE operation_log (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT,
  username   VARCHAR(50),
  module     VARCHAR(50)  COMMENT '模块',
  action     VARCHAR(50)  COMMENT '动作',
  detail     TEXT,
  ip         VARCHAR(50),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_time (created_at),
  INDEX idx_log_user (user_id)
) ENGINE=InnoDB COMMENT='操作日志';

-- ==================== 基础数据 ====================
CREATE TABLE category (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(50) NOT NULL,
  code      VARCHAR(50),
  parent_id BIGINT      NOT NULL DEFAULT 0,
  sort      INT         NOT NULL DEFAULT 0,
  created_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='器件分类';

CREATE TABLE supplier (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(50) UNIQUE,
  name       VARCHAR(100) NOT NULL,
  contact    VARCHAR(50),
  phone      VARCHAR(20),
  email      VARCHAR(100),
  address    VARCHAR(255),
  rating     TINYINT NOT NULL DEFAULT 3 COMMENT '1-5星',
  remark     VARCHAR(255),
  status     TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='供应商';

CREATE TABLE component (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  part_number   VARCHAR(100) NOT NULL UNIQUE COMMENT '内部料号',
  name          VARCHAR(100) NOT NULL COMMENT '器件名称',
  brand         VARCHAR(50)  COMMENT '品牌',
  model         VARCHAR(100) COMMENT '原厂型号',
  spec          VARCHAR(255) COMMENT '规格参数',
  package       VARCHAR(50)  COMMENT '封装',
  unit          VARCHAR(10)  NOT NULL DEFAULT 'pcs',
  category_id   BIGINT,
  lifecycle     ENUM('active','nrnd','eol') NOT NULL DEFAULT 'active' COMMENT '生命周期',
  min_stock     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '安全库存',
  moq           INT NOT NULL DEFAULT 1 COMMENT '最小起订量',
  lead_time_days INT NOT NULL DEFAULT 7 COMMENT '交期(天)',
  datasheet_url VARCHAR(255),
  remark        VARCHAR(255),
  status        TINYINT NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_comp_brand_model (brand, model),
  INDEX idx_comp_name (name),
  INDEX idx_comp_category (category_id),
  CONSTRAINT fk_comp_category FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='器件档案';

CREATE TABLE component_substitute (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  component_id BIGINT NOT NULL,
  substitute_id BIGINT NOT NULL,
  type         ENUM('full','conditional') NOT NULL DEFAULT 'full' COMMENT '完全替代/有条件替代',
  remark       VARCHAR(255),
  UNIQUE KEY uk_sub_pair (component_id, substitute_id),
  CONSTRAINT fk_sub_main FOREIGN KEY (component_id) REFERENCES component(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_alt  FOREIGN KEY (substitute_id) REFERENCES component(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='替代料';

CREATE TABLE component_supplier (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  component_id     BIGINT NOT NULL,
  supplier_id      BIGINT NOT NULL,
  supplier_part_no VARCHAR(100),
  price            DECIMAL(12,4) NOT NULL DEFAULT 0,
  moq              INT NOT NULL DEFAULT 1,
  lead_time_days   INT NOT NULL DEFAULT 7,
  is_primary       TINYINT NOT NULL DEFAULT 0 COMMENT '主供',
  UNIQUE KEY uk_cs (component_id, supplier_id),
  CONSTRAINT fk_cs_comp FOREIGN KEY (component_id) REFERENCES component(id) ON DELETE CASCADE,
  CONSTRAINT fk_cs_supp FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='器件-供应商';

-- ==================== 库存模块 ====================
CREATE TABLE stock (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  component_id BIGINT NOT NULL UNIQUE,
  quantity     DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT '现有库存',
  reserved     DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT '已预留',
  in_transit   DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT '在途',
  avg_price    DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '移动加权均价',
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_comp FOREIGN KEY (component_id) REFERENCES component(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='汇总库存';

CREATE TABLE stock_batch (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  component_id BIGINT NOT NULL,
  batch_no     VARCHAR(50),
  quantity     DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
  location     VARCHAR(50) COMMENT '库位',
  supplier_id  BIGINT,
  expiry_date  DATE COMMENT '有效期',
  status       TINYINT NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch_comp (component_id),
  CONSTRAINT fk_batch_comp FOREIGN KEY (component_id) REFERENCES component(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='批次库存';

CREATE TABLE stock_transaction (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  component_id BIGINT NOT NULL,
  type         ENUM('in','out','adjust','transfer') NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL COMMENT '正入负出',
  before_qty   DECIMAL(14,3),
  after_qty    DECIMAL(14,3),
  ref_type     VARCHAR(20) COMMENT 'inbound/outbound/purchase/stock_check/manual',
  ref_id       BIGINT,
  ref_no       VARCHAR(50) COMMENT '关联单号',
  batch_no     VARCHAR(50),
  location     VARCHAR(50),
  operator_id  BIGINT,
  remark       VARCHAR(255),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tx_comp (component_id),
  INDEX idx_tx_time (created_at),
  INDEX idx_tx_type (type)
) ENGINE=InnoDB COMMENT='出入库流水';

-- ==================== BOM 模块 ====================
CREATE TABLE bom (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  bom_no       VARCHAR(50) NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  version      VARCHAR(20) NOT NULL DEFAULT 'V1.0',
  product_name VARCHAR(100),
  remark       VARCHAR(255),
  created_by   BIGINT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='BOM 主表';

CREATE TABLE bom_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  bom_id       BIGINT NOT NULL,
  component_id BIGINT COMMENT 'NULL=未匹配',
  ref_des      VARCHAR(255) COMMENT '位号',
  part_number  VARCHAR(100) COMMENT 'BOM 原始料号',
  name         VARCHAR(100),
  brand        VARCHAR(50),
  model        VARCHAR(100),
  spec         VARCHAR(255),
  package      VARCHAR(50),
  qty_per_unit DECIMAL(12,4) NOT NULL DEFAULT 1 COMMENT '单台用量',
  loss_rate    DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '损耗率%',
  unit         VARCHAR(10) NOT NULL DEFAULT 'pcs',
  match_type   ENUM('exact','model_only','fuzzy','manual','unmatched') NOT NULL DEFAULT 'unmatched',
  remark       VARCHAR(255),
  INDEX idx_bom_item_bom (bom_id),
  INDEX idx_bom_item_comp (component_id),
  CONSTRAINT fk_bi_bom FOREIGN KEY (bom_id) REFERENCES bom(id) ON DELETE CASCADE,
  CONSTRAINT fk_bi_comp FOREIGN KEY (component_id) REFERENCES component(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='BOM 明细';

CREATE TABLE bom_analysis (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  bom_id         BIGINT NOT NULL,
  plan_qty       INT NOT NULL DEFAULT 1 COMMENT '计划生产数量',
  file_name      VARCHAR(255),
  total_items    INT NOT NULL DEFAULT 0,
  matched_items  INT NOT NULL DEFAULT 0,
  shortage_items INT NOT NULL DEFAULT 0,
  ok_items       INT NOT NULL DEFAULT 0,
  substitute_items INT NOT NULL DEFAULT 0,
  unmatched_items  INT NOT NULL DEFAULT 0,
  result         JSON COMMENT '分析明细快照',
  created_by     BIGINT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ba_bom (bom_id)
) ENGINE=InnoDB COMMENT='BOM 缺料分析快照';

-- ==================== 采购模块 ====================
CREATE TABLE purchase_request (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_no      VARCHAR(50) NOT NULL UNIQUE,
  source          ENUM('manual','bom_analysis') NOT NULL DEFAULT 'manual',
  bom_analysis_id BIGINT,
  title           VARCHAR(100),
  status          ENUM('draft','pending','approved','rejected','ordered') NOT NULL DEFAULT 'draft',
  applicant_id    BIGINT,
  approver_id     BIGINT,
  approved_at     DATETIME,
  approve_remark  VARCHAR(255),
  remark          VARCHAR(255),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_status (status)
) ENGINE=InnoDB COMMENT='采购申请';

CREATE TABLE purchase_request_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id   BIGINT NOT NULL,
  component_id BIGINT NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  remark       VARCHAR(255),
  CONSTRAINT fk_pri_req FOREIGN KEY (request_id) REFERENCES purchase_request(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='采购申请明细';

CREATE TABLE purchase_order (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no     VARCHAR(50) NOT NULL UNIQUE,
  supplier_id  BIGINT,
  request_id   BIGINT,
  status       ENUM('draft','pending','approved','sent','partial','received','cancelled') NOT NULL DEFAULT 'draft',
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_date DATE,
  created_by   BIGINT,
  sent_at      DATETIME,
  remark       VARCHAR(255),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_po_status (status)
) ENGINE=InnoDB COMMENT='采购订单';

CREATE TABLE purchase_order_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT NOT NULL,
  component_id BIGINT NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  received_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
  remark       VARCHAR(255),
  CONSTRAINT fk_poi_order FOREIGN KEY (order_id) REFERENCES purchase_order(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='采购订单明细';

-- ==================== 出入库单据 ====================
CREATE TABLE inbound_order (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no          VARCHAR(50) NOT NULL UNIQUE,
  type              ENUM('purchase','return','other') NOT NULL DEFAULT 'purchase',
  purchase_order_id BIGINT,
  supplier_id       BIGINT,
  status            ENUM('draft','confirmed','cancelled') NOT NULL DEFAULT 'draft',
  total_qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
  total_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  operator_id       BIGINT,
  confirmed_by      BIGINT,
  confirmed_at      DATETIME,
  remark            VARCHAR(255),
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_in_status (status)
) ENGINE=InnoDB COMMENT='入库单';

CREATE TABLE inbound_order_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT NOT NULL,
  component_id BIGINT NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
  batch_no     VARCHAR(50),
  location     VARCHAR(50),
  expiry_date  DATE,
  CONSTRAINT fk_ini_order FOREIGN KEY (order_id) REFERENCES inbound_order(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='入库单明细';

CREATE TABLE outbound_order (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no        VARCHAR(50) NOT NULL UNIQUE,
  type            ENUM('production','borrow','scrap','other') NOT NULL DEFAULT 'production',
  bom_id          BIGINT,
  bom_analysis_id BIGINT,
  project         VARCHAR(100),
  status          ENUM('draft','pending','confirmed','cancelled') NOT NULL DEFAULT 'draft',
  total_qty       DECIMAL(14,3) NOT NULL DEFAULT 0,
  operator_id     BIGINT,
  confirmed_by    BIGINT,
  confirmed_at    DATETIME,
  remark          VARCHAR(255),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_out_status (status)
) ENGINE=InnoDB COMMENT='出库单';

CREATE TABLE outbound_order_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT NOT NULL,
  component_id BIGINT NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  purpose      VARCHAR(255),
  CONSTRAINT fk_outi_order FOREIGN KEY (order_id) REFERENCES outbound_order(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='出库单明细';

-- ==================== 盘点 ====================
CREATE TABLE stock_check (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  check_no    VARCHAR(50) NOT NULL UNIQUE,
  scope       VARCHAR(50) COMMENT '盘点范围',
  status      ENUM('draft','in_progress','done') NOT NULL DEFAULT 'draft',
  operator_id BIGINT,
  item_count  INT NOT NULL DEFAULT 0,
  diff_count  INT NOT NULL DEFAULT 0,
  remark      VARCHAR(255),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME
) ENGINE=InnoDB COMMENT='盘点单';

CREATE TABLE stock_check_item (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  check_id     BIGINT NOT NULL,
  component_id BIGINT NOT NULL,
  batch_no     VARCHAR(50),
  book_qty     DECIMAL(14,3) NOT NULL DEFAULT 0,
  actual_qty   DECIMAL(14,3),
  diff_qty     DECIMAL(14,3) NOT NULL DEFAULT 0,
  CONSTRAINT fk_ci_check FOREIGN KEY (check_id) REFERENCES stock_check(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='盘点明细';
