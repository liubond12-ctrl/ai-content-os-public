export function isLocalArticleWrite(req:Request){
  // Exact browser Origin/Host pair; no forwarded headers are trusted.
  const url=new URL(req.url),host=req.headers.get("host")??url.host;
  let allowed=false;
  try{
    const external=new URL(url.protocol+"//"+host);
    const local=(h:string)=>["localhost","127.0.0.1","[::1]"].includes(h);
    allowed=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&local(url.hostname)&&local(external.hostname)&&external.port===url.port&&
      req.headers.get("origin")===external.origin&&
      (!req.headers.has("sec-fetch-site")||req.headers.get("sec-fetch-site")==="same-origin")&&
      (!req.headers.has("referer")||new URL(req.headers.get("referer")!).origin===external.origin);
  }catch{}
  return allowed&&Boolean(req.headers.get("content-type")?.startsWith("application/json"));
}
