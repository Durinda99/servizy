-- «Разбить на состав» позиции :item_id (одной транзакцией)
-- 1. Новые позиции: предметы комплекта × сколько комплектов ещё ждёт клиент.
INSERT INTO request_item (request_id, product_id, qty_needed, price_kop, created_at, split_from_id)
SELECT ri.request_id, bi.product_id,
       bi.quantity * (ri.qty_needed - COALESCE((SELECT SUM(qty) FROM purchase WHERE request_item_id = ri.id), 0)),
       COALESCE(
         (SELECT pp.price_kop FROM product_price pp      -- цена на дату записи
           WHERE pp.product_id = bi.product_id AND pp.valid_from <= date(ri.created_at)
           ORDER BY pp.valid_from DESC LIMIT 1),
         (SELECT pp.price_kop FROM product_price pp      -- или первая известная
           WHERE pp.product_id = bi.product_id
           ORDER BY pp.valid_from LIMIT 1)),
       ri.created_at, ri.id
FROM request_item ri
JOIN bundle_item bi ON bi.bundle_id = ri.product_id
JOIN product p ON p.id = bi.product_id AND p.is_packaging = 0
WHERE ri.id = :item_id AND ri.status = 'waiting';
-- 2. Исходная позиция уходит в архив запроса.
UPDATE request_item SET status = 'split', closed_at = datetime('now', 'localtime')
WHERE id = :item_id;
-- 3. То, что у клиента уже есть, приложение сразу снимает с ожидания (причина «уже есть»).
