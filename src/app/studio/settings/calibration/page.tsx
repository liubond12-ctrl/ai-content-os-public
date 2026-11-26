import {CalibrationWorkspace} from "@/components/CalibrationWorkspace";

export default async function Page({searchParams}:{searchParams:Promise<{account?:string|string[];item?:string|string[];records?:string}>}){
  const {account,item,records}=await searchParams;
  const initialAccount=(Array.isArray(account)?account[0]:account)??"";
  const initialItem=(Array.isArray(item)?item[0]:item)??"";
  return <CalibrationWorkspace key={JSON.stringify([initialAccount,initialItem,records])} initialAccount={initialAccount} initialItem={initialItem} records={records==="1"}/>;
}
