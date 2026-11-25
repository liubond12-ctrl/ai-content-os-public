import {it,expect,vi,beforeEach} from "vitest";
const run=vi.hoisted(()=>vi.fn(async()=>({status:"pass"})));
vi.mock("../src/studio/eval",()=>({review:run,readReviews:vi.fn(),compareReview:vi.fn()}));
import {POST} from "../src/app/api/reviews/route";
const taskId="11111111-1111-4111-8111-111111111111";
function request(headers:Record<string,string>={},url="http://localhost:3000/api/reviews"){
  return new Request(url,{method:"POST",headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000",referer:"http://127.0.0.1:3000/studio/editor","sec-fetch-site":"same-origin","content-type":"application/json",...headers},body:JSON.stringify({taskId,articleVersion:4})});
}
beforeEach(()=>run.mockClear());
it("Next 内部 localhost 与浏览器 127 Host 不同，合法同源审核能进入执行入口",async()=>{
  expect((await POST(request())).status).toBe(201);expect(run).toHaveBeenCalledWith(taskId,4);
});
it.each(["localhost:3000","[::1]:3000"])("保留本机 %s 的精确同源支持",async host=>{
  const origin="http://"+host;
  expect((await POST(request({host,origin,referer:origin+"/studio"}))).status).toBe(201);
});
it.each<Record<string,string>>([
  {origin:"http://localhost:3000"},
  {origin:"https://evil.example"},
  {origin:"null"},
  {origin:"http://127.0.0.1:3001"},
  {referer:"http://localhost:3000/studio"},
  {referer:"not-a-url"},
  {"sec-fetch-site":"cross-site"},
  {"sec-fetch-site":"same-site"},
  {host:"user@127.0.0.1:3000"},
  {host:"evil.example:3000",origin:"http://evil.example:3000",referer:"http://evil.example:3000/"},
  {host:"127.0.0.1:3001",origin:"http://127.0.0.1:3001",referer:"http://127.0.0.1:3001/"},
  {origin:"http://localhost:3000","x-forwarded-host":"localhost:3000",forwarded:"host=localhost:3000"},
])("非法来源拒绝且不进入审核：%j",async headers=>{
  expect((await POST(request(headers))).status).toBe(403);expect(run).not.toHaveBeenCalled();
});
it("代理头不改变有效 Host，保留既有无 Origin 的本机程序调用兼容性",async()=>{
  expect((await POST(request({"x-forwarded-host":"evil.example"}))).status).toBe(201);
  const req=request();req.headers.delete("origin");req.headers.delete("referer");req.headers.delete("sec-fetch-site");
  expect((await POST(req)).status).toBe(201);
});
