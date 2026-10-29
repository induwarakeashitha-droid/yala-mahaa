-- Canal names used to be "Kaudulla (middle dot) Lower"; they are now "Kaudulla - Lower".
-- Updates names farmers already saved so they still match the canal list. Safe to run more than once.
UPDATE farms SET water_name = replace(water_name, U&'\00B7', '-') WHERE water_name LIKE '%' || U&'\00B7' || '%';
UPDATE canal_reports SET canal_name = replace(canal_name, U&'\00B7', '-') WHERE canal_name LIKE '%' || U&'\00B7' || '%';
