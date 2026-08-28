// Open comments — a Quartz component with no login requirement.
// Hand-written ESM (no build step): preact is a shared external, so `h` resolves
// to Quartz's own instance. See gitLoader.ts SINGLETON_EXTERNALS.
import { h } from "preact"

const SCRIPT = `
function ocRender(list, comments) {
  list.textContent = ""
  if (!comments.length) {
    var empty = document.createElement("p")
    empty.className = "oc-empty"
    empty.textContent = "No comments yet."
    list.appendChild(empty)
    return
  }
  comments.forEach(function (c) {
    var art = document.createElement("article")
    art.className = "oc-comment"

    var head = document.createElement("header")
    head.className = "oc-head"

    var name = document.createElement("span")
    name.className = "oc-author"
    name.textContent = c.author

    var when = document.createElement("time")
    when.className = "oc-date"
    var d = new Date(c.created_at * 1000)
    when.dateTime = d.toISOString()
    when.textContent = d.toLocaleDateString("en-GB", {
      year: "numeric", month: "short", day: "numeric"
    })

    head.appendChild(name)
    head.appendChild(when)

    var text = document.createElement("p")
    text.className = "oc-text"
    text.textContent = c.body

    art.appendChild(head)
    art.appendChild(text)
    list.appendChild(art)
  })
}

function ocSetup() {
  var el = document.querySelector(".open-comments")
  if (!el) return

  var api = el.dataset.api
  var slug = el.dataset.slug
  var title = el.dataset.title || "Comments"

  if (!api) {
    el.textContent = ""
    return
  }

  el.textContent = ""

  var heading = document.createElement("h2")
  heading.className = "oc-title"
  heading.textContent = title

  var list = document.createElement("div")
  list.className = "oc-list"
  list.setAttribute("aria-live", "polite")
  list.textContent = "Loading comments..."

  var form = document.createElement("form")
  form.className = "oc-form"
  form.innerHTML = [
    '<input class="oc-input oc-name" name="author" maxlength="60" placeholder="Your name" required autocomplete="name">',
    '<input class="oc-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">',
    '<textarea class="oc-input oc-body" name="body" maxlength="4000" rows="4" placeholder="Leave a comment" required></textarea>',
    '<div class="oc-actions"><button type="submit" class="oc-submit">Post comment</button>',
    '<span class="oc-note">Comments are moderated before they appear.</span></div>',
    '<p class="oc-status" role="status"></p>'
  ].join("")

  el.appendChild(heading)
  el.appendChild(list)
  el.appendChild(form)

  var status = form.querySelector(".oc-status")
  var button = form.querySelector(".oc-submit")

  fetch(api + "/api/comments?slug=" + encodeURIComponent(slug))
    .then(function (r) { return r.json() })
    .then(function (data) { ocRender(list, data.comments || []) })
    .catch(function () { list.textContent = "Could not load comments." })

  var onSubmit = function (e) {
    e.preventDefault()
    button.disabled = true
    status.textContent = "Sending..."

    fetch(api + "/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: slug,
        author: form.author.value,
        body: form.body.value,
        website: form.website.value
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d } }) })
      .then(function (res) {
        if (res.ok) {
          form.reset()
          status.textContent = "Thanks. Your comment is awaiting moderation."
        } else {
          status.textContent = res.d.error || "Something went wrong."
        }
      })
      .catch(function () { status.textContent = "Could not send. Try again later." })
      .finally(function () { button.disabled = false })
  }

  form.addEventListener("submit", onSubmit)
  if (window.addCleanup) {
    window.addCleanup(function () { form.removeEventListener("submit", onSubmit) })
  }
}

document.addEventListener("nav", ocSetup)
document.addEventListener("render", ocSetup)
`

const CSS = `
.open-comments {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--lightgray);
}
.open-comments .oc-title {
  margin: 0 0 1rem;
  font-size: 1.2rem;
}
.open-comments .oc-comment {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--lightgray);
}
.open-comments .oc-head {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  margin-bottom: 0.25rem;
}
.open-comments .oc-author { font-weight: 600; color: var(--dark); }
.open-comments .oc-date { font-size: 0.8rem; color: var(--gray); }
.open-comments .oc-text { margin: 0; white-space: pre-wrap; color: var(--darkgray); }
.open-comments .oc-empty { color: var(--gray); font-style: italic; }
.open-comments .oc-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 1.25rem;
}
.open-comments .oc-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--darkgray);
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 5px;
}
.open-comments .oc-input:focus {
  outline: none;
  border-color: var(--secondary);
}
.open-comments .oc-hp {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.open-comments .oc-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}
.open-comments .oc-submit {
  padding: 0.45rem 1rem;
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--light);
  background: var(--secondary);
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.open-comments .oc-submit:hover:not(:disabled) { background: var(--tertiary); }
.open-comments .oc-submit:disabled { opacity: 0.6; cursor: default; }
.open-comments .oc-note { font-size: 0.8rem; color: var(--gray); }
.open-comments .oc-status:empty { display: none; }
.open-comments .oc-status { margin: 0; font-size: 0.85rem; color: var(--gray); }
`

export const OpenComments = (opts) => {
  const apiUrl = (opts && opts.apiUrl) || ""
  const title = (opts && opts.title) || "Comments"

  const OpenComments = ({ displayClass, fileData }) => {
    const override = fileData.frontmatter && fileData.frontmatter.comments
    if (override === false || override === "false") return null

    return h("div", {
      class: ["open-comments", displayClass].filter(Boolean).join(" "),
      "data-api": apiUrl,
      "data-slug": fileData.slug || "",
      "data-title": title,
    })
  }

  OpenComments.displayName = "OpenComments"
  OpenComments.css = CSS
  OpenComments.afterDOMLoaded = SCRIPT

  return OpenComments
}

export default OpenComments
