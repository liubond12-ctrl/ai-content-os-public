import {CONTRACT_VERSION} from "../../../studio/research-contract";
export const dynamic="force-dynamic";
export function GET(){
  return Response.json({build:process.env.NEXT_PUBLIC_STUDIO_BUILD??"dev-unidentified",researchContract:CONTRACT_VERSION},
    {headers:{"Cache-Control":"no-store"}});
}
