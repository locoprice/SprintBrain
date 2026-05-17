export default async (request, context) => {
  const host = request.headers.get("host") || "";
  if (host === "www.sprintbrain.com" || host === "sprintbrain.com") {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/landing/";
      return context.rewrite(url.toString());
    }
  }
  return context.next();
};
