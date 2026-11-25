import {EventDispatcher} from "@larksuiteoapi/node-sdk";
export function callbackDispatcher(call){
  return new EventDispatcher({}).register({"card.action.trigger":async data=>{
    try{
      const event=data.event??data;
      const ack=await call({action:"callback",event:{operator:event.operator,context:event.context,action:event.action}},1900);
      return {toast:{type:"info",content:ack.message}};
    }catch(e){const reason=e instanceof Error?e.message:"";
      const known=["操作者不匹配","消息不匹配","操作不可用","卡片已过期，请查看电脑工作台"];
      return {toast:{type:"warning",content:known.includes(reason)?reason:"操作未确认，请回电脑工作台查看。"}};
    }
  }});
}