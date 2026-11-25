import { z } from 'zod';
import { searchAndAssemble } from '../../../rag/search';
export async function POST(request:Request){
 try{
 const raw=await request.text();
 if(raw.length>4000)return Response.json({error:'请求过大'},{status:413});
 const parsed=z.object({query:z.string().trim().min(1).max(240),persona:z.enum(['demoa','demob']),mode:z.enum(['keyword','semantic','hybrid']).default('keyword')}).strict().safeParse(JSON.parse(raw));
 if(!parsed.success)return Response.json({error:'请输入有效账号与非空检索需求'},{status:400});
 try{return Response.json(await searchAndAssemble(parsed.data.query,parsed.data.persona,parsed.data.mode));}
 catch(e){return Response.json({error:e instanceof Error?e.message:'检索失败',requestedMode:parsed.data.mode,actualMode:null},{status:503});}
 }catch{return Response.json({error:'请求格式错误。'},{status:400});}
}
