import {afterEach,expect,it,vi} from "vitest";
const stub=vi.hoisted(()=>({send:vi.fn(),update:vi.fn()}));
vi.mock("@larksuiteoapi/node-sdk",()=>({Client:class{im={message:{create:stub.send,patch:stub.update}};}}));
import {liveTransport} from "../src/studio/feishu-message-transport";
import {renderCard} from "../src/studio/feishu-cards";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("SDK 适配器默认关闭，在完全替身 SDK 上核对单收件人、幂等键、卡片和原消息更新",async()=>{
  vi.stubEnv("FEISHU_CARD_LIVE_APPROVED","0");expect(()=>liveTransport()).toThrow("确认");
  vi.stubEnv("FEISHU_CARD_LIVE_APPROVED","1");vi.stubEnv("FEISHU_CARD_APP_ID","cli_test");vi.stubEnv("FEISHU_CARD_APP_SECRET","fixture");vi.stubEnv("FEISHU_CARD_OWNER","ou_author");
  const card=renderCard("opaque",{kind:"blocked",title:"测试",text:"需补资料",task:"t",version:4,review:"review",binding:"",options:["later"]});
  const transport=liveTransport();await expect(transport.send("ou_other","key",card)).rejects.toThrow();
  stub.send.mockResolvedValue({code:0,data:{message_id:"om_test"}});expect(await transport.send("ou_author","key",card)).toBe("om_test");
  const sent=stub.send.mock.calls[0][0];expect(sent.params.receive_id_type).toBe("open_id");expect(sent.data).toMatchObject({uuid:"key",receive_id:"ou_author",msg_type:"interactive"});expect(JSON.parse(sent.data.content)).toEqual(card);
  stub.update.mockResolvedValue({code:0});await transport.update("om_test",card);expect(stub.update.mock.calls[0][0]).toMatchObject({path:{message_id:"om_test"},data:{content:JSON.stringify(card)}});
});