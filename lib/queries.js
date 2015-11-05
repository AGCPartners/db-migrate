exports.SHOW_TABLES = 'SHOW TABLES IN `%s`';
exports.COMPARE_COLUMNS = "SELECT IF(GROUP_CONCAT(action ORDER BY action) = 'ADD,DROP','MODIFY',action) as action,column_name,ordinal_position,data_type,column_type FROM (SELECT column_name,ordinal_position,data_type,column_type,COUNT(1) as rowcount, IF(table_schema='%s', 'ADD', 'DROP') as action FROM information_schema.columns WHERE (table_schema='%s' OR table_schema='%s') AND table_name ='%s' GROUP BY column_name,data_type,column_type,table_name HAVING COUNT(1)=1)A GROUP BY column_name;";
exports.ALTER_TABLE = "ALTER TABLE %s %s COLUMN %s%s";
exports.SWITCH_DB = "USE `%s`;";
exports.CHANGE_COLUMN = "ALTER TABLE %s CHANGE COLUMN %s %s;";
exports.ADD_COLUMN = "ALTER TABLE %s ADD COLUMN %s %s;";
exports.MODIFY_COLUMN = "ALTER TABLE %s MODIFY COLUMN %s %s;";