import { demoPackage } from '@/lib/server/demo'
export const runtime='nodejs'
export async function GET(){return Response.json(demoPackage(),{headers:{'Content-Disposition':'attachment; filename="LaunchReady-Sample-Package.json"'}})}
