import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/stackoverflow.js"];
const QUESTION_URL =
  "https://stackoverflow.com/questions/4/when-should-i-use-a-decimal";

function extract(url = QUESTION_URL, options = {}) {
  const { extractStackOverflow } = loadExtractors({
    files: FILES,
    url,
    fixture: "stackoverflow-question.html",
    ...options,
  });
  return extractStackOverflow();
}

test("extractStackOverflow pulls question metadata off a question page", () => {
  const result = extract();

  assert.strictEqual(result.type, "stackoverflow");
  assert.strictEqual(result.title, "When should I use a decimal?");
  assert.strictEqual(result.url, QUESTION_URL);
  assert.match(result.content, /^Stack Overflow question/);
  assert.match(result.content, /Tags: c#, floating-point/);
  assert.match(result.content, /score 42 \| by alice/);
  assert.match(result.content, /I need to store currency/);
  assert.match(
    result.content,
    /Question comments:\n- bob: What range of values do you need\?/,
  );
});

test("extractStackOverflow keeps the accepted answer and ranks the rest by score", () => {
  const content = extract().content;

  assert.match(
    content,
    /\[1\] <replies: 1> \(score: 5\) \[accepted\] carol: Use decimal for currency/,
  );
  assert.match(content, /\[1\.1\] dave: This is the right default for money\./);
  assert.match(content, /\[2\] \(score: 100\) erin: Double is faster/);
  assert.match(content, /\[3\] \(score: 12\) frank: Integers of cents/);
});

test("extractStackOverflow prefers accepted then highest scores when capping answers", () => {
  const answers = Array.from({ length: 10 }, (_, i) => {
    const score = 90 - i * 10;
    const accepted = i === 9;
    return `
      <div class="answer${accepted ? " accepted-answer" : ""}" data-answerid="${i}">
        <div class="js-vote-count" data-value="${accepted ? 1 : score}">${accepted ? 1 : score}</div>
        <div class="s-prose js-post-body">Answer from author${i} with score ${accepted ? 1 : score}.</div>
        <div class="user-details"><a>author${i}</a></div>
      </div>`;
  }).join("");

  const html = `<!doctype html>
    <html>
      <body>
        <div id="question-header"><h1><a class="question-hyperlink">Cap test</a></h1></div>
        <div id="question" class="question">
          <div class="js-vote-count" data-value="1">1</div>
          <div class="s-prose js-post-body">Question body.</div>
        </div>
        <div id="answers">${answers}</div>
      </body>
    </html>`;

  const { extractStackOverflow } = loadExtractors({
    files: FILES,
    url: QUESTION_URL,
    html,
  });
  const content = extractStackOverflow().content;

  assert.match(content, /\[accepted\] author9:/);
  assert.match(content, /author0:/);
  assert.match(content, /author6:/);
  assert.doesNotMatch(content, /author7:/);
  assert.doesNotMatch(content, /author8:/);
});

test("extractStackOverflow handles Stack Exchange network hosts", () => {
  const result = extract(
    "https://unix.stackexchange.com/questions/4/when-should-i-use-a-decimal",
  );
  assert.strictEqual(result.type, "stackoverflow");
  assert.strictEqual(
    result.url,
    "https://unix.stackexchange.com/questions/4/when-should-i-use-a-decimal",
  );
});

test("extractStackOverflow returns null off pages it does not handle", () => {
  for (const url of [
    "https://stackoverflow.com/questions",
    "https://stackoverflow.com/questions/tagged/javascript",
    "https://stackoverflow.com/users/2/alice",
    "https://stackoverflow.com/search?q=decimal",
    "https://example.com/questions/4/not-stackoverflow",
  ]) {
    assert.strictEqual(extract(url), null, `expected null for ${url}`);
  }
});

test("extractStackOverflow reads the DOM without a network dependency", () => {
  let fetched = false;
  const result = extract(QUESTION_URL, {
    fetch() {
      fetched = true;
      throw new Error("unexpected fetch");
    },
  });

  assert.strictEqual(result.type, "stackoverflow");
  assert.strictEqual(fetched, false);
});
