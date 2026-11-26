import {CalibrationWorkspace} from "@/components/CalibrationWorkspace";

export default async function Page({searchParams}:{searchParams:Promise<{account?:string}>}){
  const {account}=await searchParams;
  return <CalibrationWorkspace key={account} initialAccount={account??""} initialItem="" records/>;
}
