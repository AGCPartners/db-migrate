# mysql-transit  [![Build Status](https://travis-ci.org/AGCPartners/mysql-transit.svg?branch=develop)](https://travis-ci.org/AGCPartners/mysql-transit)
Core package for mysql migration tool

##Installation##
`npm install mysql-transit`

##Usage##
```
var mysqlTransit = require('mysql-transit');

var mysqlTransit = new MysqlTransit('originalDB', 'newDb', {
  'host': 'localhost',
  'port': 3306,
  'user': 'root',
  'password': 'root'
});

mysqlTransit.transit({ interactive: true, safe: false }, function(err, transitResult) {
  if (err) console.log(err);
  // your code here
});

```
When you instantiate `new MysqlTransit` the first argument is the name of the database in which you want to apply the edits, the second argument is the name of the database that you want to read to find the changes and the third argument is an object with the parameters required to connect to the databases.

the first arguments of the method `mysqlTransit.transit` accept these options:
- `interactive: true|false // default true, if false it execute the queries in the originalDB without asking for user confirmation`.
- `safe: true|false // default false, if true it doesn't run the queries in the originalDB but it writes them in a file`.

##Support##
- MySQL
- MariaDB
 
