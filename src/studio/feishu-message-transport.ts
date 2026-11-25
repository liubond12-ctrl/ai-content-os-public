import {Client} from "@larksuiteoapi/node-sdk";
import type {Transport} from "./feishu-cards";

export function liveSettings(){
  const appId=process.env.FEISHU_CARD_APP_ID,appSecret=process.env.FEISHU_CARD_APP_SECRET,owner=process.env.FEISHU_CARD_OWNER;
  if(process.env.FEISHU_CARD_LIVE_APPROVED!=="1"||!appId||!appSecret||!owner?.startsWith("ou_"))throw Error("真实私聊尚未配置或确认");
  return {appId,appSecret,owner};
}
let client:Client|undefined;
export function liveTransport():Transport{
  const cfg=liveSettings();client??=new Client({appId:cfg.appId,appSecret:cfg.appSecret});
  const sdk=client;
  return {
    async send(owner,uuid,card){
      if(owner!==cfg.owner)throw Error("接收者不匹配");
      const response=await sdk.im.message.create({params:{receive_id_type:"open_id"},data:{receive_id:owner,msg_type:"interactive",content:JSON.stringify(card),uuid}});
      if(response.code!==0||!response.data?.message_id)throw Error("发送结果待核实");return response.data.message_id;
    },
    async update(message,card){
      const response=await sdk.im.message.patch({path:{message_id:message},data:{content:JSON.stringify(card)}});
      if(response.code!==0)throw Error("更新结果待核实");
    }
  };
}