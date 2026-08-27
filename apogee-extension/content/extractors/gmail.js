function sanitizeHeaderValue(str) {
  if (!str) return "";
  const clean = Array.from(str)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : ch;
    })
    .join("");
  return clean.replace(/\s+/g, " ").trim();
}

function extractGmail() {
  const subjectEl =
    document.querySelector("h1.hP") || document.querySelector(".hP");
  const subject =
    subjectEl?.innerText?.trim() ||
    subjectEl?.textContent?.trim() ||
    document.title;

  const messageEls = Array.from(document.querySelectorAll("div.a3s")).filter(
    (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
  );

  if (messageEls.length === 0) {
    return {
      type: "gmail",
      title: subject,
      url: location.href,
      content: "",
    };
  }

  let content = "";
  messageEls.forEach((el, index) => {
    if (!el || (typeof el.isConnected !== "undefined" && !el.isConnected))
      return;
    const text = (el.innerText || el.textContent || "").trim();
    if (!text) return;

    const messageContainer = el.closest?.(".adn") || el.closest?.(".gs");

    const senderEl = messageContainer?.querySelector?.(".gD");
    const rawSender =
      senderEl?.getAttribute("email") ||
      senderEl?.innerText?.trim() ||
      senderEl?.textContent?.trim() ||
      "";
    const sender = sanitizeHeaderValue(rawSender);

    const dateEl = messageContainer?.querySelector?.(".g3");
    const rawDate =
      dateEl?.getAttribute("title") ||
      dateEl?.innerText?.trim() ||
      dateEl?.textContent?.trim() ||
      "";
    const date = sanitizeHeaderValue(rawDate);

    const attachmentEls = Array.from(
      messageContainer?.querySelectorAll?.(".aQH .aV3, .aZo .aV3") || [],
    );
    const attachments = attachmentEls
      .map((a) => (a?.innerText || a?.textContent || "").trim())
      .filter(Boolean);

    let header = `--- Message ${index + 1}`;
    if (sender) header += ` from ${sender}`;
    if (date) header += ` (${date})`;
    header += " ---";

    content += `${header}\n${text}\n`;
    if (attachments.length > 0) {
      content += `Attachments: ${attachments.join(", ")}\n`;
    }
    content += "\n";
  });

  return {
    type: "gmail",
    title: subject,
    url: location.href,
    content: content.trim(),
  };
}
