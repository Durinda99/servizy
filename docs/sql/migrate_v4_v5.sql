-- Переход со схемы 4 на схему 5 (ТЗ 1.12): запроса «Отдельные товары» больше нет.
-- Каждая позиция запроса «Отдельные товары» становится своим запросом на этот товар.
-- Позиции, полученные «Разбить на состав», идут в запрос своей исходной позиции.
-- Даты записи, цены, покупки и место в очереди не меняются: они хранятся в позициях.
-- Выполняется одной транзакцией при выключенной проверке внешних ключей.
PRAGMA foreign_keys = OFF;
BEGIN;

-- 0. Вложенные комплекты (например, «Чашка с блюдцем» в составе сервиза) раскладываются на предметы:
--    в составе остаются только товары без состава
INSERT INTO bundle_item (bundle_id, product_id, quantity)
SELECT o.bundle_id, i.product_id, o.quantity * i.quantity
FROM bundle_item o JOIN bundle_item i ON i.bundle_id = o.product_id
WHERE true
ON CONFLICT (bundle_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity;
DELETE FROM bundle_item WHERE product_id IN (SELECT bundle_id FROM bundle_item);

-- 1. Какие позиции куда переезжают: группа = исходная позиция и полученные из неё разбиением
CREATE TEMP TABLE mv AS
SELECT ri.id AS item_id,
       COALESCE(ri.split_from_id, ri.id) AS grp
FROM request_item ri
JOIN request r ON r.id = ri.request_id
WHERE r.kind = 'loose';

CREATE TEMP TABLE grp AS
SELECT g.grp,
       (SELECT MAX(id) FROM request) + ROW_NUMBER() OVER (ORDER BY g.grp) AS new_id,
       r.client_id,
       gi.product_id,                                   -- товар исходной позиции (пусто у «что-то подобное»)
       CASE
         WHEN r.status = 'withdrawn' THEN 'withdrawn'
         WHEN SUM(ri.status = 'waiting') > 0 THEN 'active'
         WHEN SUM(ri.status = 'bought') > 0 THEN 'closed'
         ELSE 'withdrawn'
       END AS status,
       CASE WHEN r.status = 'withdrawn' THEN r.withdraw_reason ELSE gi.withdraw_reason END AS withdraw_reason,
       gi.created_at,
       CASE WHEN r.status = 'withdrawn' THEN r.closed_at
            WHEN SUM(ri.status = 'waiting') > 0 THEN NULL
            ELSE MAX(ri.closed_at) END AS closed_at
FROM mv g
JOIN request_item ri ON ri.id = g.item_id
JOIN request_item gi ON gi.id = g.grp
JOIN request r ON r.id = ri.request_id
GROUP BY g.grp;

-- 2. Новая таблица запросов: товар запроса вместо kind и bundle_id
CREATE TABLE request_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES product(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'withdrawn')),
  withdraw_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  closed_at TEXT,
  note TEXT
);
INSERT INTO request_v5 (id, client_id, product_id, status, withdraw_reason, created_at, closed_at, note)
SELECT id, client_id, bundle_id, status, withdraw_reason, created_at, closed_at, note
FROM request WHERE kind = 'bundle';
INSERT INTO request_v5 (id, client_id, product_id, status, withdraw_reason, created_at, closed_at)
SELECT new_id, client_id, product_id, status, withdraw_reason, created_at, closed_at FROM grp;

-- 3. Позиции переезжают в новые запросы; напоминания к старому запросу остаются у клиента
UPDATE request_item
SET request_id = (SELECT grp.new_id FROM mv JOIN grp ON grp.grp = mv.grp WHERE mv.item_id = request_item.id)
WHERE id IN (SELECT item_id FROM mv);
UPDATE reminder SET request_id = NULL
WHERE request_id IN (SELECT id FROM request WHERE kind = 'loose');

-- 4. Замена таблицы (триггеры на request удаляются вместе со старой таблицей и создаются заново)
-- legacy_alter_table: триггеры позиций ссылаются на request, пока таблицы нет
PRAGMA legacy_alter_table = ON;
DROP TABLE request;
ALTER TABLE request_v5 RENAME TO request;
PRAGMA legacy_alter_table = OFF;
DROP INDEX IF EXISTS uq_loose_request;
CREATE INDEX idx_request_product ON request(product_id);

CREATE TRIGGER trg_delete_request_only_archived
BEFORE DELETE ON request
WHEN OLD.status = 'active' AND (SELECT is_archived FROM client WHERE id = OLD.client_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'Сначала снимите запрос с ожидания');
END;

CREATE TRIGGER trg_bundle_item_leaf_insert
BEFORE INSERT ON bundle_item
WHEN EXISTS (SELECT 1 FROM bundle_item WHERE bundle_id = NEW.product_id)
  OR EXISTS (SELECT 1 FROM bundle_item WHERE product_id = NEW.bundle_id)
BEGIN
  SELECT RAISE(ABORT, 'В состав комплекта входят только товары без состава');
END;

CREATE TRIGGER trg_bundle_item_leaf_update
BEFORE UPDATE OF bundle_id, product_id ON bundle_item
WHEN EXISTS (SELECT 1 FROM bundle_item WHERE bundle_id = NEW.product_id)
  OR EXISTS (SELECT 1 FROM bundle_item WHERE product_id = NEW.bundle_id)
BEGIN
  SELECT RAISE(ABORT, 'В состав комплекта входят только товары без состава');
END;

UPDATE settings SET value = '5' WHERE key = 'schema_version';
DROP TABLE mv;
DROP TABLE grp;
COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
