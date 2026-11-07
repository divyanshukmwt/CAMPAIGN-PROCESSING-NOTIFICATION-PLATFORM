-- =============================================================================
-- Task Management System — MySQL 8.0 Least-Privilege Provisioning Script
-- =============================================================================
-- Run this script as an administrative MySQL user (e.g. root) to provision the
-- production database and a dedicated application database account that only
-- has the privileges required to run migrations and CRUD operations on
-- `task_management`.
--
-- Usage:
--   mysql -u root -p < docs/deployment/mysql-least-privilege.sql
-- =============================================================================

-- 1. Create the application database with full UTF-8 support
CREATE DATABASE IF NOT EXISTS `task_management`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. Create the dedicated application user (replace the password before running)
CREATE USER IF NOT EXISTS 'task_app'@'127.0.0.1'
  IDENTIFIED BY 'CHANGE_ME_STRONG_PRODUCTION_PASSWORD';

-- 3. Grant only schema-scoped privileges needed by the Laravel application
--    (No SUPER, FILE, GRANT OPTION, PROCESS, SHUTDOWN, or global privileges)
GRANT
  SELECT,
  INSERT,
  UPDATE,
  DELETE,
  CREATE,
  ALTER,
  INDEX,
  REFERENCES
ON `task_management`.*
TO 'task_app'@'127.0.0.1';

FLUSH PRIVILEGES;

-- 4. Verify granted privileges
SHOW GRANTS FOR 'task_app'@'127.0.0.1';
