-- ============================================================
-- knowledge_points 知识点表
-- 含索引、触发器，适用于 SQLite
-- ============================================================

-- 启用外键约束（SQLite 默认关闭，每次连接需执行）
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 主表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_points (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id    INTEGER NOT NULL REFERENCES subjects(id),
    parent_id     INTEGER REFERENCES knowledge_points(id),
    level_type    TEXT    NOT NULL DEFAULT 'knowledge_point'
                    CHECK (level_type IN (
                        'root',
                        'module', 'domain', 'unit',
                        'chapter', 'section',
                        'knowledge_point'
                    )),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    title         TEXT    NOT NULL,           -- 中文名，面向用户
    alias         TEXT,                       -- 英文标识，可空，同一学科内唯一
    content       TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),

    UNIQUE (parent_id, title),
    UNIQUE (subject_id, alias)
);

-- ------------------------------------------------------------
-- 索引：加速常见查询
-- ------------------------------------------------------------

-- 按父节点查子节点（树形遍历核心查询）
CREATE INDEX IF NOT EXISTS idx_kp_parent
    ON knowledge_points(parent_id);

-- 按学科筛选
CREATE INDEX IF NOT EXISTS idx_kp_subject
    ON knowledge_points(subject_id);

-- 按层级类型筛选（如查所有章/节）
CREATE INDEX IF NOT EXISTS idx_kp_level_type
    ON knowledge_points(level_type);

-- 组合索引：学科 + 层级（按学科查特定层级的节点）
CREATE INDEX IF NOT EXISTS idx_kp_subject_level
    ON knowledge_points(subject_id, level_type);

-- 排序查询：同级节点按 sort_order 排列
CREATE INDEX IF NOT EXISTS idx_kp_parent_sort
    ON knowledge_points(parent_id, sort_order);

-- ------------------------------------------------------------
-- 触发器：自动更新 updated_at
-- ------------------------------------------------------------

-- 使用 WHEN 条件避免 SQLite 递归触发问题
-- 只在 updated_at 未被显式修改时才自动更新
CREATE TRIGGER IF NOT EXISTS trg_kp_auto_updated_at
AFTER UPDATE ON knowledge_points
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE knowledge_points
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;

-- ------------------------------------------------------------
-- 触发器：防止循环引用（parent_id 不能指向自己）
-- ------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_kp_no_self_parent
BEFORE UPDATE OF parent_id ON knowledge_points
FOR EACH ROW
WHEN NEW.parent_id = NEW.id
BEGIN
    SELECT RAISE(ABORT, 'parent_id cannot point to self');
END;
