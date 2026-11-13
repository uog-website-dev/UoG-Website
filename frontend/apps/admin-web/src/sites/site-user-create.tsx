"use client";
import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createSiteUser } from "@/app/sites/user-actions";
import type { SiteRole } from "@/app/sites/user-actions";
import { isSiteMembershipRole } from "./site-membership";

export function SiteUserCreate({siteId,siteName,roles,onClose,onCreated}:{siteId:number;siteName:string;roles:SiteRole[];onClose:()=>void;onCreated:(username:string)=>void}) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{
    if (!file) {setPreview("");return;}
    const url=URL.createObjectURL(file);setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  function focusError(fields:Record<string,string>) {
    requestAnimationFrame(()=>{
      const field=Object.keys(fields)[0] ?? "username";
      const target=field==="role" ? formRef.current?.querySelector<HTMLElement>('[role="combobox"]') : formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`);
      target?.focus();
    });
  }
  return <Dialog open onClose={()=>!busy && onClose()} fullWidth maxWidth="sm" aria-labelledby="create-site-user-title">
    <Box component="form" ref={formRef} onSubmit={async event=>{
      event.preventDefault();if(busy)return;
      const data=new FormData(event.currentTarget);
      const local:Record<string,string>={};
      if(!data.get("role")) local.role="Choose a Site role.";
      if(data.get("password")!==data.get("password_confirmation")) local.password_confirmation="Passwords do not match.";
      if(file && file.size>2*1024*1024) local.profile_picture="Choose an image up to 2 MiB.";
      if(Object.keys(local).length) {setErrors(local);focusError(local);return;}
      setBusy(true);setErrors({});setMessage("");
      try {
        const result=await createSiteUser(siteId,data);
        if(result.ok) {formRef.current?.reset();onCreated(result.username);}
        else {setErrors(result.errors);setMessage(result.message);focusError(result.errors);}
      } catch {setMessage("Could not confirm account creation. Refresh the directory before retrying.");}
      finally {setBusy(false);}
    }}>
      <DialogTitle id="create-site-user-title">Create user</DialogTitle>
      <DialogContent sx={{display:"flex",flexDirection:"column",gap:2,pt:"12px !important"}}>
        <Typography color="text.secondary">Create an account and assign access to {siteName}.</Typography>
        {message ? <Alert severity="error">{message}</Alert> : null}
        <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",sm:"1fr 1fr"},gap:2}}>
          <TextField autoFocus required name="username" label="Username" autoComplete="off" disabled={busy} error={!!errors.username} helperText={errors.username ?? "3–150 letters, numbers, dots, +, -, @ or _."} inputProps={{minLength:3,maxLength:150,pattern:"[a-zA-Z0-9][a-zA-Z0-9._@+\\-]{2,149}"}} />
          <TextField required name="email" type="email" label="Email" autoComplete="off" disabled={busy} error={!!errors.email} helperText={errors.email} inputProps={{maxLength:254}} />
          <TextField required name="password" type="password" label="Password" autoComplete="new-password" disabled={busy} error={!!errors.password} helperText={errors.password ?? "At least 8 characters; avoid common or personal words."} inputProps={{minLength:8,maxLength:128}} />
          <TextField required name="password_confirmation" type="password" label="Confirm password" autoComplete="new-password" disabled={busy} error={!!errors.password_confirmation} helperText={errors.password_confirmation} inputProps={{maxLength:128}} />
        </Box>
        <TextField select required name="role" label="Site role" defaultValue="" disabled={busy} error={!!errors.role} helperText={errors.role ?? "Access applies to this Site only."}>
          {roles.filter(role=>role.assignable && isSiteMembershipRole(role.code)).map(role=><MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}
        </TextField>
        <Box sx={{display:"flex",gap:2,alignItems:"center",flexWrap:"wrap"}}>
          <Avatar src={preview || undefined} alt="Profile picture preview" sx={{width:64,height:64}} />
          <Box sx={{minWidth:0,flex:1}}><Typography component="label" htmlFor="new-user-picture">Profile picture (optional)</Typography>
            <input id="new-user-picture" name="profile_picture" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-describedby="new-user-picture-help" aria-invalid={!!errors.profile_picture} style={{display:"block",maxWidth:"100%",marginTop:8}} onChange={event=>setFile(event.target.files?.[0] ?? null)} />
            <Typography id="new-user-picture-help" variant="caption" color={errors.profile_picture ? "error" : "text.secondary"}>{errors.profile_picture ?? "PNG, JPEG or WebP, up to 2 MiB and 4 million pixels."}</Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{p:2}}><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>{busy ? "Creating user..." : "Create user"}</Button></DialogActions>
    </Box>
  </Dialog>;
}
