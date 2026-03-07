-- AiSchGenerator 数据库初始化脚本
-- 此脚本由 PostgreSQL 容器的 docker-entrypoint-initdb.d 自动执行
-- 注意：'aisch' 数据库已由 POSTGRES_DB 环境变量创建，此脚本做补充初始化

\connect aisch

-- 启用 uuid-ossp 扩展（如需 uuid_generate_v4()）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 确保 dev 用户拥有完整权限
GRANT ALL PRIVILEGES ON DATABASE aisch TO dev;

DO $$
BEGIN
    RAISE NOTICE 'AiSchGenerator database "aisch" initialized successfully';
END $$;
