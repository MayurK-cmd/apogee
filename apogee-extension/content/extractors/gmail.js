function extractGmail() {
  const subjectEl =
    document.querySelector("h1.hP") || document.querySelector(".hP");
  const subject = subjectEl ? subjectEl.innerText.trim() : document.title;

  const messageEls = document.querySelectorAll("div.a3s");

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
    const text = el.innerText.trim();
    if (!text) return;

    const messageContainer = el.closest(".adn") || el.closest(".gs");

    const senderEl = messageContainer?.querySelector(".gD");
    const sender =
      senderEl?.getAttribute("email") || senderEl?.innerText.trim() || "";

    const dateEl = messageContainer?.querySelector(".g3");
    const date =
      dateEl?.getAttribute("title") || dateEl?.innerText.trim() || "";

    const attachmentEls =
      messageContainer?.querySelectorAll(".aQH .aV3, .aZo .aV3") || [];
    const attachments = Array.from(attachmentEls)
      .map((a) => a.innerText.trim())
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
