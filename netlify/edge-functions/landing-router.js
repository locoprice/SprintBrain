export default async (request, context) => {
  const host = request.headers.get("host") || "";
  if (host === "www.sprintbrain.com" || host === "sprintbrain.com") {
    const url = new URL(request.url);
    const originalPath = url.pathname;
    url.pathname = "/landing" + (originalPath === "/" ? "/" : originalPath);
    return context.rewrite(url.toString());
  }
  return context.next();
};
