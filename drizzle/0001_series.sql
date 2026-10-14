CREATE TABLE IF NOT EXISTS analyses (room TEXT NOT NULL REFERENCES rooms(code), round INTEGER NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(room,round));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS room_series (room TEXT PRIMARY KEY REFERENCES rooms(code), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
INSERT OR IGNORE INTO room_series(room,data)
SELECT code,json_object('defaults',json_object('maxAnswers',max_answers,'duration',duration),'questions',json_array(json_object('id',code||'-'||round,'round',round,'question',question,'maxAnswers',max_answers,'duration',duration,'status',status,'shown',json('true'),'remaining',remaining,'deadline',deadline)),'nextRound',round+1,'view',CASE WHEN status='stopped' THEN 'results' ELSE 'question' END,'tab','cloud','title','Скоро начнём','text','Подключайтесь к комнате — ведущий скоро покажет вопрос') FROM rooms;
--> statement-breakpoint
UPDATE room_series SET data=json_set(data,'$.questions',json((
 SELECT json_group_array(json(item)) FROM (
  SELECT value AS item FROM json_each(room_series.data,'$.questions')
  UNION ALL
  SELECT json_object('id',room_series.room||'-'||old.round,'round',old.round,'question','Раунд '||old.round,'maxAnswers',r.max_answers,'duration',r.duration,'status','stopped','shown',json('true'),'remaining',0)
  FROM (SELECT room,round FROM answers UNION SELECT room,round FROM analyses) old JOIN rooms r ON r.code=old.room
  WHERE old.room=room_series.room AND old.round<>r.round AND NOT EXISTS(SELECT 1 FROM json_each(room_series.data,'$.questions') q WHERE json_extract(q.value,'$.round')=old.round)
 )
)));
