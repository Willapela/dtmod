Tudo validado. Aqui está a resposta à sua pergunta — como refazer do zero:
Os 4 comandos (validados de verdade, servidor novo + chaves novas)
1. No servidor — sobe o backend (gera CA, certificado e chave de assinatura):
scp dtunnel-server.tar.gz root@SEU_IP:~/
ssh root@SEU_IP
cd ~ && tar xzf dtunnel-server.tar.gz && cd dtunnel-server
./install.sh
2. No PC — baixa a chave pública e a CA do servidor:
cd dtunnel-mod && SSHPASS='senha' ./sync_keys.sh SEU_IP root
3. No PC — compila o APK (embute host/porta + CA + NSC):
./make_mod.sh SEU_IP 8443
4. No celular:
adb install -r dist/dt_patched_signed.apk
adb shell pm clear com.dtunnel
adb shell am start -n com.dtunnel/.presentation.ui.MainActivity
O app busca o update sozinho → Endpoints: 03, 17 RPCs no servidor. Sem adb reverse, sem login.
Está tudo no README, seção PARTE 0, com a tabela de diagnóstico.
Bugs que só apareceram nesse teste (todos corrigidos)
Fiz o ciclo completo de verdade (limpei o servidor, reinstalei, recompilei) e ele expôs 5 defeitos que nunca apareceriam no servidor já pronto:
bug	sintoma
CA com Basic Constraints duplicada (-addext colidindo com o openssl.cnf)	cadeia inválida → "unable to get local issuer certificate"
generate_private_key() sem backend	crash do gen_keys.sh em servidor novo
sync_keys.sh só procurava em $HOME	não achava o servidor instalado fora de lá
pacote do mod embutia chaves velhas	build silenciosamente usava CA errada → update não vinha
install.sh no /tmp	servidor + chaves sumiam no reboot
Também adicionei: serviço systemd (dtunnel.service, sobe sozinho no boot), checagem da CA contra o servidor no build ([ok] SEU_IP:8443 apresenta um certificado valido) e log em arquivo funcionando sob systemd.
Estado atual
dtunnel.service   active + enabled
/root/dtunnel-server   (persistente)
gRPC  0.0.0.0:8443      painel 0.0.0.0:4000
cadeia TLS             server.pem: OK
ufw 8443/4000          liberados
app                    Endpoints: 03
Pacotes finais em /home/wellington/work/dist/: dtunnel-server.tar.gz (55 KB), dtunnel-mod.tar.gz (75 MB), dtunnel-full.tar.gz (75 MB).
Uma observação: o hox.service do servidor continua na 443 e o xray dele foi consertado (config.json era 600 root com User=nobody no unit) — sem isso o túnel do celular não tem saída.