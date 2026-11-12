-- :product_id — товар, который пришёл (предмет или комплект)
WITH leaves AS (
  -- пришёл комплект: раскладываем на предметы, без упаковки
  SELECT bi.product_id AS leaf_id, bi.quantity AS qty_in_arrival
  FROM bundle_item bi
  JOIN product lp ON lp.id = bi.product_id AND lp.is_packaging = 0
  WHERE bi.bundle_id = :product_id
  UNION
  -- сам пришедший товар: отдельный предмет или комплект целиком
  SELECT :product_id, 1
),
leaf AS (
  SELECT l.leaf_id, l.qty_in_arrival, p.name, p.kind_id, p.shape_id, p.pattern_id
  FROM leaves l JOIN product p ON p.id = l.leaf_id
),
hits AS (
  SELECT ri.id AS ri_id, leaf.leaf_id, leaf.name AS item, leaf.qty_in_arrival, 0 AS whole_hint
  FROM request_item ri
  JOIN leaf ON ri.product_id = leaf.leaf_id
            OR (ri.product_id IS NULL AND ri.kind_id = leaf.kind_id
                AND ri.shape_id = leaf.shape_id AND ri.pattern_id = leaf.pattern_id)
  WHERE ri.status = 'waiting'
  UNION ALL
  -- подсказка: пришёл предмет комплекта (сам или в составе пришедшего),
  -- а клиент ждёт этот комплект целиком
  SELECT DISTINCT ri.id, ri.product_id, b.name, 1, 1
  FROM request_item ri
  JOIN bundle_item bi ON bi.bundle_id = ri.product_id
  JOIN leaf ON leaf.leaf_id = bi.product_id
  JOIN product b ON b.id = ri.product_id
  WHERE ri.status = 'waiting'
    AND ri.product_id NOT IN (SELECT leaf_id FROM leaf)
)
SELECT c.name AS client, c.phone, COALESCE(b.name, 'Что-то подобное') AS request_title,
       h.item, h.qty_in_arrival, h.whole_hint,
       ri.qty_needed - COALESCE((SELECT SUM(qty) FROM purchase WHERE request_item_id = ri.id), 0) AS remaining,
       ri.created_at, ri.price_kop AS price_at_signup,
       (SELECT pp.price_kop FROM product_price pp
         WHERE pp.product_id = :product_id AND pp.valid_from <= date('now')
         ORDER BY pp.valid_from DESC LIMIT 1) AS arrival_price_now
FROM hits h
JOIN request_item ri ON ri.id = h.ri_id
JOIN request r ON r.id = ri.request_id AND r.status = 'active'
JOIN client c ON c.id = r.client_id AND c.is_archived = 0
LEFT JOIN product b ON b.id = r.product_id
WHERE remaining > 0
ORDER BY h.whole_hint, ri.created_at;
