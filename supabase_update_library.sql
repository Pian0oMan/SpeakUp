-- UPDATE: deck library, Anki import, pronunciation + proficiency.
-- Run it in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is SAFE TO RUN AGAIN: it skips what already exists and replaces the starter decks.
-- If Supabase offers to "enable RLS" for you, choose to run it AS WRITTEN:
-- this file already turns on Row Level Security for every new table.

-- ===== CARD COLUMNS =====
-- reading:     how to read the word, e.g. 元気 -> げんき
-- explanation: notes about the word, like on Anki / Renshuu cards
-- source:      where the card came from: chat (you saved it), library, or anki
-- language:    the language of the word, so it can be pronounced correctly
-- proficiency: 0 to 100, how well you know it (the colored ring)
alter table flashcards add column if not exists reading text;
alter table flashcards add column if not exists explanation text;
alter table flashcards add column if not exists source text not null default 'chat';
alter table flashcards add column if not exists language text;
alter table flashcards add column if not exists proficiency integer not null default 0;

-- ===== THE LIBRARY: ready-made decks that everyone can see =====
-- Only the developers add decks (here in the SQL Editor); users copy them into their own decks.
create table if not exists library_decks (
  id                   bigint generated always as identity primary key,
  name                 text not null,
  language             text not null,  -- the language of the words, e.g. Japanese
  translation_language text not null,  -- the language of the translations, e.g. English
  description          text,
  created_at           timestamptz not null default now()
);
alter table library_decks enable row level security;

create table if not exists library_cards (
  id          bigint generated always as identity primary key,
  deck_id     bigint not null references library_decks on delete cascade,
  word        text not null,
  reading     text,
  translation text not null,
  explanation text,
  example     text
);
alter table library_cards enable row level security;

-- Logged-in users can READ the library. There are no insert/update/delete policies,
-- so nobody can change it from the website, only the developers here in Supabase.
-- ("drop ... if exists" first, so running this file twice doesn't fail)
drop policy if exists "Logged-in users can read library decks" on library_decks;
create policy "Logged-in users can read library decks" on library_decks
  for select to authenticated using (true);
drop policy if exists "Logged-in users can read library cards" on library_cards;
create policy "Logged-in users can read library cards" on library_cards
  for select to authenticated using (true);

-- Remove the starter decks before adding them (again), so they never appear twice.
-- Their cards go too ("on delete cascade"). Decks users copied are separate and stay.
delete from library_decks where name in (
  'Japanese Greetings', 'Spanish Basics', 'Everyday English',  -- the old, small starter decks
  'Japanese for Beginners', 'Spanish for Beginners', 'English for Beginners'
);


-- =====================================================================
-- 1. JAPANESE FOR BEGINNERS (for English speakers)
-- =====================================================================
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('Japanese for Beginners', 'Japanese', 'English',
          'Your first 100+ Japanese words: greetings, numbers, time, food, places, everyday verbs and adjectives, and phrases you can use right away.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, c.reading, c.translation, c.explanation, c.example
from deck, (values
  -- Greetings and manners
  ('こんにちは', null, 'hello / good afternoon', 'Greetings. From late morning to early evening.', 'こんにちは、はじめまして。'),
  ('おはようございます', null, 'good morning', 'Greetings. Polite. Friends just say おはよう.', 'おはようございます！'),
  ('こんばんは', null, 'good evening', 'Greetings. Used after dark.', 'こんばんは、元気ですか？'),
  ('はじめまして', null, 'nice to meet you', 'Greetings. Only the first time you meet a person.', 'はじめまして、アレックスです。'),
  ('よろしくお願いします', 'よろしくおねがいします', 'nice to meet you / please treat me well', 'Greetings. No exact English version. Said after introducing yourself or asking a favor.', 'どうぞよろしくお願いします。'),
  ('ありがとうございます', null, 'thank you', 'Manners. Polite. Casual: ありがとう.', '本当にありがとうございます。'),
  ('すみません', null, 'excuse me / sorry', 'Manners. Also used to call a waiter or to thank a person for their trouble.', 'すみません、ちょっといいですか？'),
  ('ごめんなさい', null, 'I am sorry', 'Manners. A real apology. Casual: ごめん.', '遅れてごめんなさい。'),
  ('おやすみなさい', null, 'good night', 'Greetings. Before going to bed. Casual: おやすみ.', 'おやすみなさい、また明日。'),
  ('さようなら', null, 'goodbye', 'Greetings. Sounds final. Friends say じゃあね or またね.', 'さようなら、元気でね。'),
  ('またね', null, 'see you', 'Greetings. Casual goodbye.', 'じゃあ、またね！'),
  ('いただきます', null, '(said before eating)', 'Manners. A thank-you for the meal, said by everyone before eating.', 'いただきます！'),
  ('ごちそうさまでした', null, '(said after eating)', 'Manners. Thanks for the meal, after you finish.', 'ごちそうさまでした、おいしかったです。'),
  -- The basics
  ('はい', null, 'yes', 'Basics. Also means "I am listening".', 'はい、そうです。'),
  ('いいえ', null, 'no', 'Basics. Polite. In casual talk people often say ううん.', 'いいえ、違います。'),
  ('お願いします', 'おねがいします', 'please', 'Basics. When asking for something.', 'お水をお願いします。'),
  ('大丈夫', 'だいじょうぶ', 'okay / all right', 'Basics. Also "no thanks" when offered something.', '大丈夫ですか？'),
  ('分かりました', 'わかりました', 'I understand / got it', 'Basics. Polite.', 'はい、分かりました。'),
  ('分かりません', 'わかりません', 'I do not understand', 'Basics. Very useful for learners.', 'すみません、分かりません。'),
  ('もう一度', 'もういちど', 'one more time', 'Basics. Ask a person to repeat.', 'もう一度お願いします。'),
  ('ゆっくり', null, 'slowly', 'Basics. Ask a person to slow down.', 'ゆっくり話してください。'),
  -- People
  ('私', 'わたし', 'I / me', 'People. The safe, polite word for "I".', '私はアレックスです。'),
  ('あなた', null, 'you', 'People. Japanese people usually use the name instead.', 'あなたの名前は？'),
  ('彼', 'かれ', 'he / boyfriend', 'People. Can also mean boyfriend.', '彼は学生です。'),
  ('彼女', 'かのじょ', 'she / girlfriend', 'People. Can also mean girlfriend.', '彼女は先生です。'),
  ('友達', 'ともだち', 'friend', 'People.', '友達と話します。'),
  ('家族', 'かぞく', 'family', 'People.', '家族は四人です。'),
  ('母', 'はは', 'my mother', 'People. Your own mother. Someone else''s mother: お母さん.', '母は料理が上手です。'),
  ('父', 'ちち', 'my father', 'People. Your own father. Someone else''s father: お父さん.', '父は会社員です。'),
  ('名前', 'なまえ', 'name', 'People.', 'お名前は何ですか？'),
  ('先生', 'せんせい', 'teacher', 'People. Also used for doctors.', '先生、質問があります。'),
  -- Numbers
  ('一', 'いち', 'one', 'Numbers.', '一つください。'),
  ('二', 'に', 'two', 'Numbers.', '二人です。'),
  ('三', 'さん', 'three', 'Numbers.', '三時に会いましょう。'),
  ('四', 'よん', 'four', 'Numbers. Also read し, but よん is safer.', '四月です。'),
  ('五', 'ご', 'five', 'Numbers.', '五分待ってください。'),
  ('六', 'ろく', 'six', 'Numbers.', '六時に起きます。'),
  ('七', 'なな', 'seven', 'Numbers. Also read しち.', '七月が好きです。'),
  ('八', 'はち', 'eight', 'Numbers.', '八時に寝ます。'),
  ('九', 'きゅう', 'nine', 'Numbers. Also read く.', '九時から働きます。'),
  ('十', 'じゅう', 'ten', 'Numbers.', '十分です。'),
  ('百', 'ひゃく', 'one hundred', 'Numbers.', '百円です。'),
  -- Time
  ('今日', 'きょう', 'today', 'Time.', '今日は暑いですね。'),
  ('明日', 'あした', 'tomorrow', 'Time.', '明日また会いましょう。'),
  ('昨日', 'きのう', 'yesterday', 'Time.', '昨日は忙しかったです。'),
  ('今', 'いま', 'now', 'Time.', '今、何をしていますか？'),
  ('朝', 'あさ', 'morning', 'Time.', '朝ごはんを食べました。'),
  ('夜', 'よる', 'night / evening', 'Time.', '夜は家にいます。'),
  ('週末', 'しゅうまつ', 'weekend', 'Time.', '週末は何をしますか？'),
  ('毎日', 'まいにち', 'every day', 'Time.', '毎日日本語を勉強します。'),
  ('何時', 'なんじ', 'what time', 'Time.', '今、何時ですか？'),
  ('時間', 'じかん', 'time / hour', 'Time.', '時間がありません。'),
  -- Question words
  ('何', 'なに / なん', 'what', 'Questions. Read なん before です and counters.', 'これは何ですか？'),
  ('誰', 'だれ', 'who', 'Questions.', 'あの人は誰ですか？'),
  ('どこ', null, 'where', 'Questions.', 'トイレはどこですか？'),
  ('いつ', null, 'when', 'Questions.', '誕生日はいつですか？'),
  ('なぜ', null, 'why', 'Questions. In conversation, どうして or なんで is more common.', 'なぜ日本語を勉強していますか？'),
  ('どう', null, 'how', 'Questions.', '日本はどうですか？'),
  ('いくら', null, 'how much (price)', 'Questions.', 'これはいくらですか？'),
  ('どれ', null, 'which one', 'Questions.', 'どれがいいですか？'),
  -- Food and drink
  ('水', 'みず', 'water', 'Food. Politely: お水.', 'お水をください。'),
  ('ご飯', 'ごはん', 'rice / a meal', 'Food. Means both cooked rice and a meal.', 'ご飯を食べましょう。'),
  ('お茶', 'おちゃ', 'tea (green tea)', 'Food.', 'お茶を飲みませんか？'),
  ('コーヒー', null, 'coffee', 'Food.', 'コーヒーが好きです。'),
  ('肉', 'にく', 'meat', 'Food.', '肉と魚、どちらが好きですか？'),
  ('魚', 'さかな', 'fish', 'Food.', '魚をよく食べます。'),
  ('野菜', 'やさい', 'vegetables', 'Food.', '野菜を食べてください。'),
  ('美味しい', 'おいしい', 'delicious', 'Food. Often written in hiragana: おいしい.', 'このラーメン、美味しい！'),
  ('お腹が空いた', 'おなかがすいた', 'I am hungry', 'Food. Casual.', 'お腹が空いたね。'),
  ('ラーメン', null, 'ramen', 'Food.', 'ラーメンを食べに行こう。'),
  -- Places
  ('家', 'いえ', 'house / home', 'Places. Also read うち (my home).', '家に帰ります。'),
  ('学校', 'がっこう', 'school', 'Places.', '学校は八時からです。'),
  ('駅', 'えき', 'station', 'Places.', '駅はどこですか？'),
  ('店', 'みせ', 'shop / store', 'Places.', 'この店は安いです。'),
  ('公園', 'こうえん', 'park', 'Places.', '公園を散歩します。'),
  ('トイレ', null, 'toilet / restroom', 'Places.', 'トイレはどこですか？'),
  ('会社', 'かいしゃ', 'company / office', 'Places.', '会社で働いています。'),
  ('日本', 'にほん', 'Japan', 'Places.', '日本に行きたいです。'),
  -- Everyday verbs
  ('食べる', 'たべる', 'to eat', 'Verbs. Polite: 食べます.', '寿司を食べます。'),
  ('飲む', 'のむ', 'to drink', 'Verbs. Polite: 飲みます.', 'コーヒーを飲みます。'),
  ('行く', 'いく', 'to go', 'Verbs. Polite: 行きます.', '明日、東京に行きます。'),
  ('来る', 'くる', 'to come', 'Verbs. Polite: 来ます (きます).', '友達が来ます。'),
  ('見る', 'みる', 'to see / to watch', 'Verbs. Polite: 見ます.', 'アニメを見ます。'),
  ('聞く', 'きく', 'to listen / to ask', 'Verbs. Polite: 聞きます.', '音楽を聞きます。'),
  ('話す', 'はなす', 'to speak / to talk', 'Verbs. Polite: 話します.', '日本語を話します。'),
  ('読む', 'よむ', 'to read', 'Verbs. Polite: 読みます.', '本を読みます。'),
  ('書く', 'かく', 'to write', 'Verbs. Polite: 書きます.', '名前を書いてください。'),
  ('買う', 'かう', 'to buy', 'Verbs. Polite: 買います.', '新しい服を買いました。'),
  ('寝る', 'ねる', 'to sleep / to go to bed', 'Verbs. Polite: 寝ます.', '十一時に寝ます。'),
  ('起きる', 'おきる', 'to wake up / to get up', 'Verbs. Polite: 起きます.', '毎朝七時に起きます。'),
  ('分かる', 'わかる', 'to understand', 'Verbs. Polite: 分かります.', '少し分かります。'),
  ('勉強する', 'べんきょうする', 'to study', 'Verbs. Polite: 勉強します.', '毎日勉強します。'),
  ('する', null, 'to do', 'Verbs. Polite: します. Used in many other verbs.', '週末は何をしますか？'),
  -- Adjectives
  ('好き', 'すき', 'to like / liked', 'Adjectives. 〜が好きです = I like ~.', '猫が好きです。'),
  ('嫌い', 'きらい', 'to dislike / disliked', 'Adjectives. Strong. People often say あまり好きじゃない instead.', '虫が嫌いです。'),
  ('大きい', 'おおきい', 'big', 'Adjectives.', '大きい犬ですね。'),
  ('小さい', 'ちいさい', 'small', 'Adjectives.', '小さい部屋です。'),
  ('高い', 'たかい', 'expensive / tall / high', 'Adjectives.', 'この時計は高いです。'),
  ('安い', 'やすい', 'cheap', 'Adjectives.', 'この店は安いです。'),
  ('楽しい', 'たのしい', 'fun', 'Adjectives.', '今日は楽しかった！'),
  ('難しい', 'むずかしい', 'difficult', 'Adjectives.', '漢字は難しいです。'),
  ('簡単', 'かんたん', 'easy / simple', 'Adjectives. Na-adjective: 簡単な問題.', 'この問題は簡単です。'),
  ('暑い', 'あつい', 'hot (weather)', 'Adjectives. For hot things you touch: 熱い.', '今日はとても暑いです。'),
  ('寒い', 'さむい', 'cold (weather)', 'Adjectives. For cold things you touch: 冷たい.', '冬は寒いです。'),
  ('新しい', 'あたらしい', 'new', 'Adjectives.', '新しいスマホを買いました。'),
  ('いい', null, 'good', 'Adjectives. Past tense is よかった, not いかった.', 'いい天気ですね。'),
  -- Useful phrases
  ('〜はどこですか', '〜はどこですか', 'where is ~?', 'Phrases.', '駅はどこですか？'),
  ('〜をください', '〜をください', 'please give me ~', 'Phrases. For ordering and shopping.', 'コーヒーをください。'),
  ('日本語を勉強しています', 'にほんごをべんきょうしています', 'I am studying Japanese', 'Phrases.', 'はい、日本語を勉強しています。'),
  ('英語を話せますか', 'えいごをはなせますか', 'can you speak English?', 'Phrases.', 'すみません、英語を話せますか？'),
  ('これは何ですか', 'これはなんですか', 'what is this?', 'Phrases.', 'これは何ですか？おいしそう！'),
  ('〜と言います', '〜といいます', 'my name is ~ / it is called ~', 'Phrases.', 'アレックスと言います。')
) as c(word, reading, translation, explanation, example);


-- =====================================================================
-- 2. SPANISH FOR BEGINNERS (for English speakers)
-- =====================================================================
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('Spanish for Beginners', 'Spanish', 'English',
          'Your first 100+ Spanish words: greetings, numbers, time, food, places, the most common verbs and adjectives, and phrases you can use right away.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, null, c.translation, c.explanation, c.example
from deck, (values
  -- Greetings
  ('hola', 'hello / hi', 'Greetings. Any time of day, anyone.', '¡Hola! ¿Qué tal?'),
  ('buenos días', 'good morning', 'Greetings. Until about lunchtime.', 'Buenos días, señora.'),
  ('buenas tardes', 'good afternoon', 'Greetings. From lunchtime until dark.', 'Buenas tardes, ¿cómo está?'),
  ('buenas noches', 'good evening / good night', 'Greetings. When arriving or leaving at night.', 'Buenas noches, hasta mañana.'),
  ('adiós', 'goodbye', 'Greetings.', 'Adiós, nos vemos.'),
  ('hasta luego', 'see you later', 'Greetings. Friendly and very common.', '¡Hasta luego!'),
  ('hasta mañana', 'see you tomorrow', 'Greetings.', 'Hasta mañana, que descanses.'),
  ('¿cómo estás?', 'how are you?', 'Greetings. Informal (tú). Formal: ¿cómo está usted?', 'Hola Ana, ¿cómo estás?'),
  ('¿qué tal?', 'how is it going?', 'Greetings. Casual.', '¿Qué tal el trabajo?'),
  ('mucho gusto', 'nice to meet you', 'Greetings. First meeting.', 'Mucho gusto, me llamo Alex.'),
  -- Manners
  ('gracias', 'thank you', 'Manners. Muchas gracias = thank you very much.', 'Muchas gracias por todo.'),
  ('de nada', 'you are welcome', 'Manners. The usual reply to gracias.', '—Gracias. —De nada.'),
  ('por favor', 'please', 'Manners.', 'Un café, por favor.'),
  ('perdón', 'excuse me / sorry', 'Manners. For small things.', 'Perdón, ¿tienes hora?'),
  ('lo siento', 'I am sorry', 'Manners. A real apology, or sympathy.', 'Lo siento, no puedo ir.'),
  ('con permiso', 'excuse me (to pass)', 'Manners. When you need to get past someone.', 'Con permiso, gracias.'),
  ('sí', 'yes', 'Basics. With an accent. Without it, si means "if".', 'Sí, claro.'),
  ('no', 'no / not', 'Basics.', 'No, gracias.'),
  -- The basics
  ('bien', 'well / fine', 'Basics. Muy bien = very well.', 'Estoy bien, ¿y tú?'),
  ('mal', 'badly / not well', 'Basics.', 'Hoy me siento mal.'),
  ('más o menos', 'so-so', 'Basics. Literally "more or less".', '—¿Qué tal? —Más o menos.'),
  ('no entiendo', 'I do not understand', 'Basics. Very useful for learners.', 'Perdón, no entiendo.'),
  ('¿puedes repetir?', 'can you repeat?', 'Basics.', '¿Puedes repetir, por favor?'),
  ('más despacio', 'more slowly', 'Basics.', 'Más despacio, por favor.'),
  ('¿cómo se dice...?', 'how do you say...?', 'Basics.', '¿Cómo se dice "bench" en español?'),
  ('claro', 'of course / sure', 'Basics.', '¡Claro que sí!'),
  -- People
  ('yo', 'I', 'People. Often left out: (yo) hablo = I speak.', 'Yo soy de Canadá.'),
  ('tú', 'you (informal)', 'People. With an accent. Formal: usted.', '¿Y tú?'),
  ('él', 'he', 'People. With an accent. Without it, el means "the".', 'Él es mi amigo.'),
  ('ella', 'she', 'People.', 'Ella habla tres idiomas.'),
  ('nosotros', 'we', 'People. Nosotras if everyone is female.', 'Nosotros vivimos aquí.'),
  ('amigo', 'friend (male)', 'People. Female: amiga.', 'Es mi mejor amigo.'),
  ('familia', 'family', 'People.', 'Mi familia es grande.'),
  ('madre', 'mother', 'People. Casual: mamá.', 'Mi madre es profesora.'),
  ('padre', 'father', 'People. Casual: papá.', 'Mi padre trabaja mucho.'),
  ('hermano', 'brother', 'People. Sister: hermana.', 'Tengo un hermano.'),
  ('nombre', 'name', 'People.', '¿Cuál es tu nombre?'),
  -- Numbers
  ('uno', 'one', 'Numbers. Before a masculine noun: un libro.', 'Tengo uno.'),
  ('dos', 'two', 'Numbers.', 'Dos cafés, por favor.'),
  ('tres', 'three', 'Numbers.', 'Son las tres.'),
  ('cuatro', 'four', 'Numbers.', 'Somos cuatro.'),
  ('cinco', 'five', 'Numbers.', 'Cinco minutos.'),
  ('seis', 'six', 'Numbers.', 'A las seis.'),
  ('siete', 'seven', 'Numbers.', 'Siete días.'),
  ('ocho', 'eight', 'Numbers.', 'Ocho horas.'),
  ('nueve', 'nine', 'Numbers.', 'Nueve años.'),
  ('diez', 'ten', 'Numbers.', 'Diez euros.'),
  ('cien', 'one hundred', 'Numbers.', 'Cien por ciento.'),
  -- Time
  ('hoy', 'today', 'Time.', 'Hoy hace calor.'),
  ('mañana', 'tomorrow / morning', 'Time. La mañana = the morning.', 'Nos vemos mañana.'),
  ('ayer', 'yesterday', 'Time.', 'Ayer fui al cine.'),
  ('ahora', 'now', 'Time. Ahora mismo = right now.', 'Ahora no puedo.'),
  ('la noche', 'the night', 'Time.', 'Trabajo por la noche.'),
  ('el fin de semana', 'the weekend', 'Time.', '¿Qué haces el fin de semana?'),
  ('la hora', 'the hour / the time', 'Time.', '¿Tienes la hora?'),
  ('todos los días', 'every day', 'Time.', 'Estudio todos los días.'),
  ('¿qué hora es?', 'what time is it?', 'Time.', 'Perdón, ¿qué hora es?'),
  ('tarde', 'late / afternoon', 'Time. La tarde = the afternoon. Llegar tarde = to be late.', 'Lo siento, llego tarde.'),
  -- Question words
  ('qué', 'what', 'Questions. With an accent in questions.', '¿Qué es esto?'),
  ('quién', 'who', 'Questions.', '¿Quién es ella?'),
  ('dónde', 'where', 'Questions.', '¿Dónde está el baño?'),
  ('cuándo', 'when', 'Questions.', '¿Cuándo es tu cumpleaños?'),
  ('por qué', 'why', 'Questions. Two words. Porque (one word) = because.', '¿Por qué estudias español?'),
  ('cómo', 'how', 'Questions.', '¿Cómo te llamas?'),
  ('cuánto', 'how much', 'Questions. Cuántos = how many.', '¿Cuánto cuesta?'),
  ('cuál', 'which / what', 'Questions.', '¿Cuál prefieres?'),
  -- Food and drink
  ('agua', 'water', 'Food. Uses el even though it is feminine: el agua.', 'Un vaso de agua, por favor.'),
  ('comida', 'food / meal', 'Food.', 'La comida está lista.'),
  ('pan', 'bread', 'Food.', 'Compro pan cada mañana.'),
  ('café', 'coffee', 'Food.', '¿Quieres un café?'),
  ('carne', 'meat', 'Food.', 'No como carne.'),
  ('pescado', 'fish (as food)', 'Food. A living fish is pez.', 'Me gusta el pescado.'),
  ('verduras', 'vegetables', 'Food.', 'Come más verduras.'),
  ('rico', 'delicious / tasty', 'Food. Also means "rich". Feminine: rica.', '¡Qué rico!'),
  ('tengo hambre', 'I am hungry', 'Food. Literally "I have hunger".', 'Tengo mucha hambre.'),
  ('la cuenta', 'the bill / the check', 'Food. At a restaurant.', 'La cuenta, por favor.'),
  -- Places
  ('casa', 'house / home', 'Places. En casa = at home.', 'Estoy en casa.'),
  ('escuela', 'school', 'Places.', 'Voy a la escuela.'),
  ('estación', 'station', 'Places.', '¿Dónde está la estación?'),
  ('tienda', 'shop / store', 'Places.', 'La tienda abre a las nueve.'),
  ('parque', 'park', 'Places.', 'Vamos al parque.'),
  ('baño', 'bathroom / restroom', 'Places.', '¿Dónde está el baño?'),
  ('trabajo', 'work / job', 'Places. Also "I work".', 'Voy al trabajo en bus.'),
  ('ciudad', 'city', 'Places.', 'Es una ciudad bonita.'),
  -- Everyday verbs
  ('ser', 'to be (who/what something is)', 'Verbs. For identity and description: soy Alex.', 'Soy estudiante.'),
  ('estar', 'to be (how/where something is)', 'Verbs. For feelings and location: estoy cansado.', 'Estoy en casa.'),
  ('tener', 'to have', 'Verbs. Also for age: tengo veinte años.', 'Tengo dos hermanos.'),
  ('ir', 'to go', 'Verbs. Voy, vas, va...', 'Voy al cine.'),
  ('comer', 'to eat', 'Verbs.', '¿Qué quieres comer?'),
  ('beber', 'to drink', 'Verbs. In Latin America, tomar is also common.', 'Bebo mucha agua.'),
  ('hablar', 'to speak / to talk', 'Verbs.', 'Hablo un poco de español.'),
  ('ver', 'to see / to watch', 'Verbs.', 'Veo películas los sábados.'),
  ('escuchar', 'to listen', 'Verbs.', 'Escucho música.'),
  ('leer', 'to read', 'Verbs.', 'Me gusta leer.'),
  ('escribir', 'to write', 'Verbs.', 'Escribe tu nombre aquí.'),
  ('comprar', 'to buy', 'Verbs.', 'Quiero comprar esto.'),
  ('dormir', 'to sleep', 'Verbs. Duermo = I sleep.', 'Duermo ocho horas.'),
  ('querer', 'to want / to love', 'Verbs. Quiero = I want. Te quiero = I love you.', 'Quiero un café.'),
  ('hacer', 'to do / to make', 'Verbs. Also for weather: hace frío.', '¿Qué haces?'),
  -- Adjectives
  ('grande', 'big', 'Adjectives.', 'Es una casa grande.'),
  ('pequeño', 'small', 'Adjectives. Feminine: pequeña.', 'Un perro pequeño.'),
  ('caro', 'expensive', 'Adjectives. Feminine: cara.', 'Es muy caro.'),
  ('barato', 'cheap', 'Adjectives. Feminine: barata.', 'Este es más barato.'),
  ('divertido', 'fun', 'Adjectives. Feminine: divertida.', '¡Fue muy divertido!'),
  ('difícil', 'difficult', 'Adjectives.', 'El español no es difícil.'),
  ('fácil', 'easy', 'Adjectives.', 'Es muy fácil.'),
  ('hace calor', 'it is hot (weather)', 'Adjectives. Literally "it makes heat".', 'Hoy hace mucho calor.'),
  ('hace frío', 'it is cold (weather)', 'Adjectives.', 'En invierno hace frío.'),
  ('nuevo', 'new', 'Adjectives. Feminine: nueva.', 'Tengo un móvil nuevo.'),
  ('bueno', 'good', 'Adjectives. Before a masculine noun: buen día.', 'Es un buen libro.'),
  -- Useful phrases
  ('¿dónde está...?', 'where is...?', 'Phrases.', '¿Dónde está la estación?'),
  ('quiero...', 'I want...', 'Phrases. Quisiera... is more polite.', 'Quiero una pizza.'),
  ('me gusta', 'I like', 'Phrases. Literally "it pleases me". Me gustan for plural things.', 'Me gusta la música.'),
  ('me llamo', 'my name is', 'Phrases. Literally "I call myself".', 'Me llamo Alex.'),
  ('estoy aprendiendo español', 'I am learning Spanish', 'Phrases.', 'Estoy aprendiendo español, perdón.'),
  ('¿hablas inglés?', 'do you speak English?', 'Phrases.', 'Perdón, ¿hablas inglés?')
) as c(word, translation, explanation, example);


-- =====================================================================
-- 3. ENGLISH FOR BEGINNERS (for Japanese speakers)
-- =====================================================================
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('English for Beginners', 'English', 'Japanese',
          '初めての英語。挨拶、会話でよく使うフレーズ、基本の動詞と形容詞。Your first English words and phrases.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, null, c.translation, c.explanation, c.example
from deck, (values
  -- Greetings
  ('hello', 'こんにちは', '挨拶。いつでも使える。', 'Hello, nice to meet you.'),
  ('hi', 'やあ / こんにちは', '挨拶。カジュアル。', 'Hi! How are you?'),
  ('good morning', 'おはよう(ございます)', '挨拶。午前中。', 'Good morning, everyone!'),
  ('good night', 'おやすみ(なさい)', '挨拶。寝る前、別れるとき。', 'Good night, see you tomorrow.'),
  ('nice to meet you', 'はじめまして', '挨拶。初めて会ったとき。', 'Nice to meet you, I am Yuki.'),
  ('how are you?', '元気ですか？', '挨拶。毎日の挨拶として使う。', 'Hi Alex, how are you?'),
  ('I am fine, thank you', '元気です、ありがとう', '挨拶。How are you? への返事。', 'I am fine, thank you. And you?'),
  ('see you later', 'またね', '挨拶。カジュアルな別れ。', 'Bye, see you later!'),
  ('goodbye', 'さようなら', '挨拶。', 'Goodbye, take care.'),
  -- Manners
  ('thank you', 'ありがとう', 'マナー。thanks はもっとカジュアル。', 'Thank you so much!'),
  ('you are welcome', 'どういたしまして', 'マナー。thank you への返事。', 'You are welcome!'),
  ('please', 'お願いします / どうぞ', 'マナー。お願いするとき文の最後か最初につける。', 'Water, please.'),
  ('sorry', 'ごめんなさい / すみません', 'マナー。謝るとき。', 'Sorry, I am late.'),
  ('excuse me', 'すみません', 'マナー。声をかけるとき、通るとき。', 'Excuse me, where is the station?'),
  -- Conversation
  ('I see', 'なるほど', '会話。相づち。', 'Oh, I see.'),
  ('really?', '本当？', '会話。驚いたとき。', 'Really? That is amazing!'),
  ('me too', '私も', '会話。同意するとき。', 'I like ramen. Me too!'),
  ('sounds good', 'いいね', '会話。提案に賛成するとき。', 'Pizza tonight? Sounds good!'),
  ('no worries', '気にしないで', '会話。ありがとう・ごめんへの返事。', 'No worries at all.'),
  ('could you say that again?', 'もう一度言ってもらえますか？', '会話。聞き取れなかったとき。', 'Sorry, could you say that again?'),
  ('what does that mean?', 'それはどういう意味？', '会話。知らない言葉を聞いたとき。', 'What does "awesome" mean?'),
  ('how do you say ... in English?', '〜は英語で何と言いますか？', '会話。', 'How do you say 猫 in English?'),
  ('I do not understand', '分かりません', '会話。', 'Sorry, I do not understand.'),
  ('slowly, please', 'ゆっくりお願いします', '会話。', 'Could you speak slowly, please?'),
  -- People
  ('friend', '友達', '人。', 'She is my best friend.'),
  ('family', '家族', '人。', 'I live with my family.'),
  ('mother', '母 / お母さん', '人。カジュアル: mom.', 'My mother is a nurse.'),
  ('father', '父 / お父さん', '人。カジュアル: dad.', 'My father likes golf.'),
  ('name', '名前', '人。', 'What is your name?'),
  -- Everyday verbs
  ('eat', '食べる', '動詞。過去形: ate.', 'I eat breakfast at seven.'),
  ('drink', '飲む', '動詞。過去形: drank.', 'I drink coffee every morning.'),
  ('go', '行く', '動詞。過去形: went.', 'I go to school by train.'),
  ('come', '来る', '動詞。過去形: came.', 'Can you come tomorrow?'),
  ('watch', '見る(テレビ・映画)', '動詞。動いているものを見るとき。', 'I watch anime on weekends.'),
  ('listen', '聞く', '動詞。listen to music のように to が必要。', 'I listen to music on the train.'),
  ('talk', '話す', '動詞。talk to / talk about.', 'Can we talk later?'),
  ('read', '読む', '動詞。過去形も read (発音は red)。', 'I read a lot of manga.'),
  ('write', '書く', '動詞。過去形: wrote.', 'Please write your name here.'),
  ('buy', '買う', '動詞。過去形: bought.', 'I want to buy a new phone.'),
  ('sleep', '寝る', '動詞。過去形: slept.', 'I sleep at midnight.'),
  ('work', '働く / 仕事', '動詞・名詞。', 'I work at a hotel.'),
  ('study', '勉強する', '動詞。', 'I study English every day.'),
  ('like', '好き', '動詞。I like ~ = 〜が好き。', 'I like cats.'),
  ('want', '欲しい / 〜したい', '動詞。want to ~ = 〜したい。', 'I want to visit Canada.'),
  -- Adjectives
  ('good', 'いい / 良い', '形容詞。', 'This is a good idea.'),
  ('bad', '悪い', '形容詞。', 'The weather is bad today.'),
  ('big', '大きい', '形容詞。', 'Tokyo is a big city.'),
  ('small', '小さい', '形容詞。', 'I have a small dog.'),
  ('expensive', '高い(値段)', '形容詞。', 'This bag is expensive.'),
  ('cheap', '安い', '形容詞。', 'This shop is cheap.'),
  ('fun', '楽しい', '形容詞。', 'The party was fun!'),
  ('boring', 'つまらない', '形容詞。', 'The movie was boring.'),
  ('difficult', '難しい', '形容詞。hard とも言う。', 'English grammar is difficult.'),
  ('easy', '簡単', '形容詞。', 'This test is easy.'),
  ('hot', '暑い / 熱い', '形容詞。天気にも物にも使う。', 'It is hot today.'),
  ('cold', '寒い / 冷たい', '形容詞。天気にも物にも使う。', 'It is cold outside.'),
  ('tired', '疲れた', '形容詞。', 'I am so tired.'),
  ('hungry', 'お腹が空いた', '形容詞。I am hungry = お腹が空いた。', 'I am hungry. Let us eat!'),
  ('busy', '忙しい', '形容詞。', 'I am busy this week.'),
  -- Time and questions
  ('today', '今日', '時間。', 'What are you doing today?'),
  ('tomorrow', '明日', '時間。', 'See you tomorrow!'),
  ('yesterday', '昨日', '時間。', 'I was sick yesterday.'),
  ('now', '今', '時間。', 'I am busy now.'),
  ('weekend', '週末', '時間。', 'What did you do last weekend?'),
  ('what time is it?', '今何時？', '時間。', 'Excuse me, what time is it?'),
  ('what', '何', '質問。', 'What is this?'),
  ('who', '誰', '質問。', 'Who is that?'),
  ('where', 'どこ', '質問。', 'Where do you live?'),
  ('when', 'いつ', '質問。', 'When is your birthday?'),
  ('why', 'なぜ / どうして', '質問。', 'Why are you learning English?'),
  ('how much', 'いくら', '質問。値段を聞くとき。', 'How much is this?')
) as c(word, translation, explanation, example);
