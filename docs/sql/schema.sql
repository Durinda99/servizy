PRAGMA foreign_keys = ON;

CREATE TABLE section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_kind (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE shape (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE pattern (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article TEXT UNIQUE,
  name TEXT NOT NULL,
  kind_id INTEGER REFERENCES product_kind(id),
  shape_id INTEGER REFERENCES shape(id),
  pattern_id INTEGER REFERENCES pattern(id),
  collection_id INTEGER REFERENCES collection(id),
  subsection TEXT,
  material TEXT,
  persons INTEGER CHECK (persons >= 1),
  items_count INTEGER CHECK (items_count >= 1),
  weight_g INTEGER CHECK (weight_g >= 0),
  height_mm INTEGER,
  length_mm INTEGER,
  width_mm INTEGER,
  volume_ml INTEGER,
  year_start INTEGER,
  sold_separately INTEGER NOT NULL DEFAULT 1 CHECK (sold_separately IN (0, 1)),
  is_packaging INTEGER NOT NULL DEFAULT 0 CHECK (is_packaging IN (0, 1)),
  site_status TEXT,
  url TEXT,
  photo_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('file', 'manual')),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE product_section (
  product_id INTEGER NOT NULL REFERENCES product(id),
  section_id INTEGER NOT NULL REFERENCES section(id),
  PRIMARY KEY (product_id, section_id)
);

CREATE TABLE product_price (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  price_kop INTEGER NOT NULL CHECK (price_kop >= 0),
  valid_from TEXT NOT NULL,
  UNIQUE (product_id, valid_from)
);

CREATE TABLE bundle_item (
  bundle_id INTEGER NOT NULL REFERENCES product(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  PRIMARY KEY (bundle_id, product_id),
  CHECK (bundle_id <> product_id)
);

CREATE TABLE client (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'bundle' CHECK (kind IN ('bundle', 'loose')),
  bundle_id INTEGER REFERENCES product(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'withdrawn')),
  withdraw_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  closed_at TEXT,
  note TEXT,
  CHECK ((kind = 'bundle' AND bundle_id IS NOT NULL) OR (kind = 'loose' AND bundle_id IS NULL))
);

CREATE TABLE request_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES product(id),
  kind_id INTEGER REFERENCES product_kind(id),
  shape_id INTEGER REFERENCES shape(id),
  pattern_id INTEGER REFERENCES pattern(id),
  qty_needed INTEGER NOT NULL CHECK (qty_needed >= 1),
  price_kop INTEGER CHECK (price_kop >= 0),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'bought', 'withdrawn', 'split')),
  withdraw_reason TEXT,
  split_from_id INTEGER REFERENCES request_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT,
  closed_at TEXT,
  note TEXT,
  CHECK (
    (product_id IS NOT NULL AND kind_id IS NULL AND shape_id IS NULL AND pattern_id IS NULL)
    OR
    (product_id IS NULL AND price_kop IS NULL
     AND kind_id IS NOT NULL AND shape_id IS NOT NULL AND pattern_id IS NOT NULL)
  )
);

CREATE TABLE purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_item_id INTEGER NOT NULL REFERENCES request_item(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty >= 1),
  purchased_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES request(id) ON DELETE CASCADE,
  request_item_id INTEGER REFERENCES request_item(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'done')),
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_product_name ON product(name);
CREATE INDEX idx_product_match ON product(kind_id, shape_id, pattern_id);
CREATE INDEX idx_bundle_item_product ON bundle_item(product_id);
CREATE INDEX idx_request_item_product ON request_item(product_id);
CREATE INDEX idx_request_item_match ON request_item(kind_id, shape_id, pattern_id);
CREATE INDEX idx_request_item_request ON request_item(request_id);
CREATE INDEX idx_request_item_split ON request_item(split_from_id);
CREATE INDEX idx_purchase_item ON purchase(request_item_id);
CREATE INDEX idx_reminder_at ON reminder(remind_at);
CREATE INDEX idx_price_lookup ON product_price(product_id, valid_from);
CREATE INDEX idx_client_name ON client(name);

-- У клиента один активный запрос «Отдельные товары»
CREATE UNIQUE INDEX uq_loose_request ON request(client_id) WHERE kind = 'loose' AND status = 'active';

-- «Изменить»: нужное количество не меньше уже купленного
CREATE TRIGGER trg_qty_not_below_bought
BEFORE UPDATE OF qty_needed ON request_item
WHEN NEW.qty_needed < (SELECT COALESCE(SUM(qty), 0) FROM purchase WHERE request_item_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'Нужно не может быть меньше уже купленного');
END;

-- «Удалить навсегда» только из архива
CREATE TRIGGER trg_delete_client_only_archived
BEFORE DELETE ON client WHEN OLD.is_archived = 0
BEGIN
  SELECT RAISE(ABORT, 'Сначала перенесите клиента в архив');
END;

CREATE TRIGGER trg_delete_request_only_archived
BEFORE DELETE ON request
WHEN OLD.status = 'active' AND (SELECT is_archived FROM client WHERE id = OLD.client_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'Сначала снимите запрос с ожидания');
END;

-- «Разбить на состав» только у ждущей позиции, у которой товар — комплект
CREATE TRIGGER trg_split_only_waiting_bundle
BEFORE UPDATE OF status ON request_item
WHEN NEW.status = 'split' AND (OLD.status <> 'waiting'
  OR NOT EXISTS (SELECT 1 FROM bundle_item WHERE bundle_id = OLD.product_id))
BEGIN
  SELECT RAISE(ABORT, 'Разбить на состав можно только ждущий комплект целиком');
END;

CREATE TRIGGER trg_delete_item_only_archived
BEFORE DELETE ON request_item
WHEN OLD.status = 'waiting'
  AND (SELECT status FROM request WHERE id = OLD.request_id) = 'active'
  AND (SELECT c.is_archived FROM request r JOIN client c ON c.id = r.client_id WHERE r.id = OLD.request_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'Сначала снимите позицию с ожидания');
END;

INSERT INTO section (name, sort_order) VALUES
  ('Столовые предметы', 1), ('Чайно-кофейные предметы', 2), ('Сервизы', 3);
INSERT INTO settings (key, value) VALUES ('schema_version', '4');
