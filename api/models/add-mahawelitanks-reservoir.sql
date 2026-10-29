-- Links each Mahaweli Authority tank to the same tank in the Irrigation Department's reservoir list.
-- The tank forecast (/api/forecast/:id) then uses that reservoir's daily readings, which go back months,
-- instead of the few Mahaweli readings. Names differ between the two sources, hence the list.
-- Safe to run more than once; run after the tanks and reservoirs are loaded.

ALTER TABLE mahawelitanks ADD COLUMN IF NOT EXISTS reservoir_id INT REFERENCES reservoirs(id) ON DELETE SET NULL;

UPDATE mahawelitanks t SET reservoir_id = r.id
FROM (VALUES
  ('Ridiyagama', 'Ridiyagama'), ('Mapakada', 'Mapakada'), ('Dambarawa', 'Dambarawa'), ('Sorabora', 'Sorabora'),
  ('Vakaneri', 'Vakaneri'), ('Huruluwewa', 'Huruluwewa'), ('Thuruvila', 'Thuruwila tank'),
  ('Nachchaduwa', 'Nachchaduwa'), ('Nuwarawewa', 'Nuwara Wewa'),
  -- The Mahaweli H-area Tissawewa is Anuradhapura's "Thissa wewa", not Hambantota's Tissawewa
  ('Tissawewa', 'Thissa wewa'),
  ('Basawakkulama', 'Basavakkulama (Abaya wewa)'), ('Rajanganaya', 'Rajangana'), ('Angamuwa', 'Angamuwa'),
  ('PSS', 'Parakrama Samudraya'), ('Giritale', 'Giritale'), ('Minneriya', 'Minneriya'), ('Kaudulla', 'Kaudulla'),
  ('Kantale', 'Kantale'), ('Vendrason', 'Vendrasan'), ('Alikotaara', 'Alikota ara'),
  ('Hadapanagala', 'Handapanagala'), ('Lunugamwehera', 'Lunugamwehera')
) AS m(tank_name, reservoir_name)
JOIN reservoirs r ON lower(r.name) = lower(m.reservoir_name)
WHERE t.tank_name = m.tank_name;
