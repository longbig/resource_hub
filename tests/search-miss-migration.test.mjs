import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('网盘分类迁移完整保留旧搜索和点击，历史统一未分类，复合外键隔离同词网盘',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const migrations=readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort();
 for(const file of migrations.filter(file=>file<'0005'))db.exec(readFileSync('migrations/'+file,'utf8'));
 const timestamps={first:'2026-10-01T01:02:03.004Z',last:'2026-10-27T05:06:07.008Z',click:'2026-10-28T09:10:11.012Z'};
 db.prepare('INSERT INTO search_misses(keyword,count,first_searched_at,last_searched_at) VALUES(?,?,?,?)').run('excel',7,timestamps.first,timestamps.last);
 db.prepare('INSERT INTO search_misses(keyword,count,first_searched_at,last_searched_at) VALUES(?,?,?,?)').run('没有点击的旧词',3,timestamps.first,timestamps.last);
 db.prepare('INSERT INTO network_result_clicks(id,keyword,title,url,clicked_at) VALUES(?,?,?,?,?)').run('legacy-click','excel','旧点击标题','https://pan.quark.cn/s/legacy',timestamps.click);
 const providerMigrations=migrations.filter(file=>file.startsWith('0005'));assert.equal(providerMigrations.length,1);
 // D1 migrations execute inside a transaction with foreign keys enabled.
 db.exec('BEGIN');
 try{db.exec(readFileSync('migrations/'+providerMigrations[0],'utf8'));db.exec('COMMIT');}
 catch(error){db.exec('ROLLBACK');throw error;}
 assert.deepEqual(db.prepare('SELECT * FROM search_misses ORDER BY keyword').all().map(row=>({...row})),[
  {keyword:'excel',provider:'unknown',count:7,first_searched_at:timestamps.first,last_searched_at:timestamps.last},
  {keyword:'没有点击的旧词',provider:'unknown',count:3,first_searched_at:timestamps.first,last_searched_at:timestamps.last}
 ]);
 assert.deepEqual({...db.prepare('SELECT * FROM network_result_clicks').get()},{id:'legacy-click',keyword:'excel',provider:'unknown',title:'旧点击标题',url:'https://pan.quark.cn/s/legacy',clicked_at:timestamps.click});
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const pk=db.prepare('PRAGMA table_info(search_misses)').all().filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);assert.deepEqual(pk,['keyword','provider']);
 db.prepare('INSERT INTO search_misses(keyword,provider,count) VALUES(?,?,?)').run('excel','quark',2);
 db.prepare('INSERT INTO network_result_clicks(id,keyword,provider,title,url) VALUES(?,?,?,?,?)').run('quark-click','excel','quark','新夸克点击','https://pan.quark.cn/s/new');
 assert.throws(()=>db.prepare('INSERT INTO network_result_clicks(id,keyword,provider,title,url) VALUES(?,?,?,?,?)').run('unmatched-baidu','excel','baidu','百度错误归属','https://pan.baidu.com/s/new'),/FOREIGN KEY/);
 db.prepare('INSERT INTO search_misses(keyword,provider,count) VALUES(?,?,?)').run('excel','baidu',1);
 db.prepare('INSERT INTO network_result_clicks(id,keyword,provider,title,url) VALUES(?,?,?,?,?)').run('baidu-click','excel','baidu','新百度点击','https://pan.baidu.com/s/new');
 assert.deepEqual(db.prepare('SELECT provider,count FROM search_misses WHERE keyword=? ORDER BY provider').all('excel').map(row=>({...row})),[{provider:'baidu',count:1},{provider:'quark',count:2},{provider:'unknown',count:7}]);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
