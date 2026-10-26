// DISCOVER: a feed where everyone shares their progress (like LinkedIn),
// and other learners can cheer them on. It's also a way to find new friends.

let posts = [];
let people = []; // "People to meet": they share my interests and aren't my friends yet

async function loadPosts() {
  try {
    posts = await api("/api/posts");
  } catch {
    posts = []; // e.g. 08_friends_discover.sql hasn't been run yet
  }
  renderPosts();
}

function renderPosts() {
  const feed = el("postFeed");
  feed.innerHTML = "";
  if (!Array.isArray(posts) || posts.length === 0) {
    feed.innerHTML = emptyState("idle", "No posts yet. Be the first to share a win!");
    return;
  }
  posts.forEach(post => feed.appendChild(makePostCard(post)));
}

// One post: who wrote it, what they wrote, their progress card, and the buttons
function makePostCard(post) {
  const card = document.createElement("article");
  card.className = "card post";

  // Top: avatar, name, country, languages, how long ago
  const head = document.createElement("div");
  head.className = "post-head";
  const avatar = document.createElement("div");
  avatar.className = "person-avatar";
  avatar.textContent = post.author_name[0].toUpperCase();
  const who = document.createElement("div");
  who.className = "post-who";
  const name = document.createElement("strong");
  name.textContent = post.author_name;
  const details = document.createElement("span");
  details.className = "post-details";
  details.append(countryTag(post.country));
  if (post.learning) details.append(`Learning ${post.learning}`);
  if (post.fluency) details.append(fluencyTag(post.fluency));
  who.append(name, details);
  const when = document.createElement("span");
  when.className = "post-time";
  when.textContent = timeAgo(post.created_at);
  head.append(avatar, who, when);

  // The post itself (textContent, so nobody can sneak HTML into the page)
  const body = document.createElement("p");
  body.className = "post-body";
  body.textContent = post.body;
  card.append(head, body);

  // Something in common? (not on my own posts)
  const both = post.mine ? [] : sharedInterests(post.interests);
  if (both.length) {
    const common = document.createElement("p");
    common.className = "post-common";
    common.textContent = `You both like ${interestList(both)}`;
    card.appendChild(common);
  }

  // The progress card, if they attached one
  if (post.stats) {
    const stats = document.createElement("div");
    stats.className = "post-stats";
    [["star", `Level ${post.stats.level}`],
     ["flame", `${post.stats.streak}-day streak`],
     ["decks", `${post.stats.words} words learned`]].forEach(([iconName, text]) => {
      const item = document.createElement("span");
      item.innerHTML = icon(iconName);
      item.append(text);
      stats.appendChild(item);
    });
    card.appendChild(stats);
  }

  // Bottom: Cheer on the left; Add friend (or Delete, on my own posts) on the right
  const foot = document.createElement("div");
  foot.className = "post-foot";
  const cheer = document.createElement("button");
  cheer.className = "cheer-btn" + (post.cheered ? " cheered" : "");
  cheer.innerHTML = icon("sparkle");
  cheer.append(post.cheers ? `Cheer · ${post.cheers}` : "Cheer");
  cheer.title = post.cheered ? "Take back your cheer" : "Cheer them on";
  cheer.onclick = () => toggleCheer(post);
  foot.appendChild(cheer);
  if (post.mine) {
    foot.appendChild(smallButton("Delete", () => deletePost(post)));
  } else if (relationTo(post.user_id) !== "friend") {
    foot.appendChild(makeFriendButton(post.user_id, post.author_name));
  }
  card.appendChild(foot);
  return card;
}

// ---------- PEOPLE TO MEET ----------
async function loadPeople() {
  try {
    people = await api("/api/people");
  } catch {
    people = [];
  }
  renderPeople();
}

function renderPeople() {
  const list = el("peopleList");
  list.innerHTML = "";
  // Hide anyone who became my friend since the list was loaded
  const toShow = (Array.isArray(people) ? people : []).filter(person => relationTo(person.user_id) !== "friend");
  el("peopleBox").hidden = toShow.length === 0;
  toShow.forEach(person => {
    const card = document.createElement("div");
    card.className = "meet-card";
    const avatar = document.createElement("div");
    avatar.className = "person-avatar big";
    avatar.textContent = person.username[0].toUpperCase();
    const name = document.createElement("strong");
    name.textContent = person.username;
    const langs = document.createElement("div");
    langs.className = "meet-langs";
    langs.append(languageTag(person.native, person.learning));
    if (person.fluency) langs.append(fluencyTag(person.fluency));
    card.append(avatar, name, countryTag(person.country), langs,
      interestChips(person.interests, 3), makeFriendButton(person.user_id, person.username));
    list.appendChild(card);
  });
}

function renderDiscover() {
  renderPeople();
  renderPosts();
}

async function toggleCheer(post) {
  const result = await api(`/api/posts/${post.id}/cheer`, { method: "POST" });
  post.cheered = result.cheered;
  post.cheers = result.cheers;
  renderPosts();
}

async function deletePost(post) {
  if (!confirm("Delete this post?")) return;
  await api(`/api/posts/${post.id}`, { method: "DELETE" });
  loadPosts();
}

// Writing a post
el("postText").oninput = () => (el("postCount").textContent = `${el("postText").value.length} / 500`);
el("postForm").onsubmit = async event => {
  event.preventDefault();
  const text = el("postText").value.trim();
  if (!text) return;
  const result = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ text, share_stats: el("postStats").checked }),
  });
  if (result.error) return showToast(result.error);
  el("postText").value = "";
  el("postCount").textContent = "0 / 500";
  showToast("Posted!");
  loadPosts();
};

el("navDiscover").onclick = () => {
  showView("discoverView");
  loadPosts();
  loadPeople();
};

// Someone posted (or deleted a post): refresh, if I'm looking at the feed
socket.on("posts_changed", () => {
  if (!el("discoverView").hidden) loadPosts();
});
