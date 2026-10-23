-- UPDATE: deck library + Anki import.
-- Run this ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

-- Cards can have a reading (e.g. 元気 -> げんき) and an explanation, like Anki/Renshuu cards.
-- "source" = where the card came from: chat (you saved it), library, or anki.
alter table flashcards add column if not exists reading text;
alter table flashcards add column if not exists explanation text;
alter table flashcards add column if not exists source text not null default 'chat';

-- THE LIBRARY: ready-made decks that everyone can see.
-- Only the developers add decks (here in the SQL Editor); users copy them into their own decks.
create table if not exists library_decks (
  id                   bigint generated always as identity primary key,
  name                 text not null,
  language             text not null,  -- the language of the words, e.g. Japanese
  translation_language text not null,  -- the language of the translations, e.g. English
  description          text,
  created_at           timestamptz not null default now()
);

create table if not exists library_cards (
  id          bigint generated always as identity primary key,
  deck_id     bigint not null references library_decks on delete cascade,
  word        text not null,
  reading     text,
  translation text not null,
  explanation text,
  example     text
);

alter table library_decks enable row level security;
alter table library_cards enable row level security;

-- Everyone who is logged in can READ the library. Nobody can change it from the website
-- (there are no insert/update/delete policies), only the developers here in Supabase.
create policy "Logged-in users can read library decks" on library_decks
  for select to authenticated using (true);
create policy "Logged-in users can read library cards" on library_cards
  for select to authenticated using (true);


-- ===== STARTER DECKS =====

-- 1. Japanese Greetings (for English speakers)
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('Japanese Greetings', 'Japanese', 'English',
          'The everyday greetings and polite phrases you will hear in your first conversations.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, c.reading, c.translation, c.explanation, c.example
from deck, (values
  ('こんにちは', null, 'hello / good afternoon', 'Used from late morning to early evening. Between close friends it can sound a little formal.', 'こんにちは、はじめまして。'),
  ('おはようございます', null, 'good morning (polite)', 'With friends and family, just おはよう.', 'おはようございます！今日は寒いですね。'),
  ('こんばんは', null, 'good evening', 'Used after dark, when meeting someone.', 'こんばんは、元気ですか？'),
  ('ありがとうございます', null, 'thank you (polite)', 'With friends, ありがとう is enough.', '手伝ってくれて、ありがとうございます。'),
  ('すみません', null, 'excuse me / sorry', 'Also used to get attention (e.g. calling a waiter) or to thank someone for their trouble.', 'すみません、駅はどこですか？'),
  ('ごめんなさい', null, 'I am sorry', 'A real apology. Casual version: ごめん.', '遅れてごめんなさい。'),
  ('はじめまして', null, 'nice to meet you', 'Said only the first time you meet someone, usually at the start of an introduction.', 'はじめまして、アレックスです。'),
  ('よろしくお願いします', 'よろしくおねがいします', 'please treat me well / nice to meet you', 'Has no exact English version. Said after introducing yourself, or when asking for a favor.', 'これからよろしくお願いします。'),
  ('お元気ですか', 'おげんきですか', 'how are you?', 'Not a daily greeting like in English. Used with someone you have not seen for a while.', 'お久しぶりです！お元気ですか？'),
  ('元気です', 'げんきです', 'I am fine', 'The usual answer to お元気ですか.', 'はい、元気です。'),
  ('おやすみなさい', null, 'good night', 'Said before going to bed. Casual: おやすみ.', 'もう遅いね。おやすみなさい。'),
  ('さようなら', null, 'goodbye', 'Sounds quite final, almost like "farewell". Friends say じゃあね or またね.', 'さようなら、また会いましょう。'),
  ('またね', null, 'see you', 'Casual goodbye between friends.', 'じゃあ、またね！'),
  ('いただきます', null, '(said before eating)', 'A thank-you for the food. Everyone says it before a meal.', 'いただきます！'),
  ('ごちそうさまでした', null, '(said after eating)', 'Thanks for the meal, said when you finish eating.', 'おいしかった！ごちそうさまでした。')
) as c(word, reading, translation, explanation, example);

-- 2. Spanish Basics (for English speakers)
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('Spanish Basics', 'Spanish', 'English',
          'Greetings, manners, and the small words that keep a conversation going.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, null, c.translation, c.explanation, c.example
from deck, (values
  ('hola', 'hello / hi', 'Works for any time of day, with anyone.', '¡Hola! ¿Qué tal?'),
  ('buenos días', 'good morning', 'Until about lunchtime.', 'Buenos días, ¿cómo estás?'),
  ('buenas noches', 'good evening / good night', 'Used both when arriving and leaving at night.', 'Buenas noches, hasta mañana.'),
  ('gracias', 'thank you', 'Muchas gracias = thank you very much.', 'Muchas gracias por tu ayuda.'),
  ('por favor', 'please', 'Usually at the end of a request.', 'Un café, por favor.'),
  ('de nada', 'you are welcome', 'The usual reply to gracias.', '—Gracias. —¡De nada!'),
  ('perdón', 'excuse me / sorry', 'For small things: bumping into someone, getting attention.', 'Perdón, ¿dónde está el baño?'),
  ('lo siento', 'I am sorry', 'A real apology, or to show sympathy.', 'Lo siento mucho, llego tarde.'),
  ('¿cómo estás?', 'how are you?', 'Informal (tú). Formal: ¿cómo está usted?', 'Hola Ana, ¿cómo estás?'),
  ('¿qué tal?', 'how is it going?', 'Very common and casual. Can stand alone or be followed by a topic.', '¿Qué tal el fin de semana?'),
  ('bien', 'well / fine', 'Muy bien = very well. Answer to ¿cómo estás?', 'Estoy bien, gracias.'),
  ('me llamo', 'my name is', 'Literally "I call myself".', 'Me llamo Alex, ¿y tú?'),
  ('mucho gusto', 'nice to meet you', 'Said when meeting someone for the first time.', 'Mucho gusto, Ana.'),
  ('hasta luego', 'see you later', 'A friendly, common goodbye.', '¡Hasta luego!'),
  ('adiós', 'goodbye', 'Also used as a quick "bye" when passing someone.', 'Adiós, que tengas un buen día.')
) as c(word, translation, explanation, example);

-- 3. Everyday English (for Japanese speakers)
with deck as (
  insert into library_decks (name, language, translation_language, description)
  values ('Everyday English', 'English', 'Japanese',
          '会話でよく使う英語のフレーズ。Common English phrases for daily conversation.')
  returning id
)
insert into library_cards (deck_id, word, reading, translation, explanation, example)
select deck.id, c.word, null, c.translation, c.explanation, c.example
from deck, (values
  ('how is it going?', '調子はどう？', 'How are you? よりカジュアルな挨拶。', 'Hey Yuki, how is it going?'),
  ('not bad', 'まあまあだよ', '「悪くない」= けっこう良い、という意味。', 'Not bad, thanks. And you?'),
  ('nice to meet you', 'はじめまして', '初めて会ったときに言う。', 'Hi, I am Alex. Nice to meet you!'),
  ('what do you do?', 'お仕事は何ですか？', '職業を聞く表現。今何をしているか、ではない。', 'So, what do you do?'),
  ('I am into', '〜にハマっている', '趣味や好きなことを話すとき。', 'I am into anime and cooking.'),
  ('no worries', '気にしないで', 'ありがとう・ごめんへの返事。', 'No worries, it happens!'),
  ('my bad', 'ごめん、私のせい', 'カジュアルな謝り方。', 'Oops, my bad!'),
  ('see you later', 'またね', '友達同士の別れの挨拶。', 'Gotta go, see you later!'),
  ('could you say that again?', 'もう一度言ってもらえますか？', '聞き取れなかったときに使える丁寧な表現。', 'Sorry, could you say that again?'),
  ('what does that mean?', 'それはどういう意味？', '知らない言葉を聞くとき。', 'What does "lowkey" mean?'),
  ('I see', 'なるほど', '相手の話を理解したときの相づち。', 'Oh, I see. That makes sense.'),
  ('sounds good', 'いいね / それでいいよ', '提案に賛成するとき。', 'Pizza tonight? Sounds good!')
) as c(word, translation, explanation, example);
