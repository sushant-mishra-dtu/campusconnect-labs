#include "signer.h"

#include <Preferences.h>

#include "mbedtls/base64.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecdsa.h"
#include "mbedtls/entropy.h"
#include "mbedtls/md.h"
#include "mbedtls/pk.h"
#include "mbedtls/version.h"

namespace {

Preferences prefs;
mbedtls_pk_context pk;
mbedtls_entropy_context entropy;
mbedtls_ctr_drbg_context drbg;
char idBuf[16];
char pemBuf[256];
uint32_t ctr = 0;

bool loadKey() {
  size_t len = prefs.getBytesLength("sk");
  if (len == 0 || len > 256) return false;
  uint8_t der[256];
  prefs.getBytes("sk", der, len);
#if MBEDTLS_VERSION_MAJOR >= 3
  return mbedtls_pk_parse_key(&pk, der, len, nullptr, 0, mbedtls_ctr_drbg_random, &drbg) == 0;
#else
  return mbedtls_pk_parse_key(&pk, der, len, nullptr, 0) == 0;
#endif
}

bool generateKey() {
  if (mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) != 0) return false;
  if (mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk), mbedtls_ctr_drbg_random, &drbg) != 0) return false;
  uint8_t der[256];
  int n = mbedtls_pk_write_key_der(&pk, der, sizeof(der));  // written at the end of the buffer
  if (n <= 0) return false;
  prefs.putBytes("sk", der + sizeof(der) - n, n);
  return true;
}

}  // namespace

namespace signer {

bool begin() {
  prefs.begin("ccl", false);
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&drbg);
  const char *pers = "ccl-examiner";
  if (mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy, (const uint8_t *)pers, strlen(pers)) != 0) return false;

  mbedtls_pk_init(&pk);
  if (!loadKey()) {
    mbedtls_pk_free(&pk);
    mbedtls_pk_init(&pk);
    if (!generateKey()) return false;
  }
  if (mbedtls_pk_write_pubkey_pem(&pk, (uint8_t *)pemBuf, sizeof(pemBuf)) != 0) return false;

  uint64_t mac = ESP.getEfuseMac();
  snprintf(idBuf, sizeof(idBuf), "ex-%06llx", (unsigned long long)((mac >> 24) & 0xffffff));
  ctr = prefs.getUInt("ctr", 0);
  return true;
}

const char *examinerId() { return idBuf; }
const char *publicKeyPem() { return pemBuf; }
uint32_t counter() { return ctr; }

uint32_t nextCounter() {
  ctr += 1;
  prefs.putUInt("ctr", ctr);
  return ctr;
}

bool sign(const String &payload, String &sigB64) {
  uint8_t hash[32];
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mbedtls_md(md, (const uint8_t *)payload.c_str(), payload.length(), hash) != 0) return false;

  uint8_t sig[MBEDTLS_ECDSA_MAX_LEN];
  size_t sigLen = 0;
#if MBEDTLS_VERSION_MAJOR >= 3
  int rc = mbedtls_pk_sign(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, sizeof(sig), &sigLen, mbedtls_ctr_drbg_random, &drbg);
#else
  int rc = mbedtls_pk_sign(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, &sigLen, mbedtls_ctr_drbg_random, &drbg);
#endif
  if (rc != 0) return false;

  uint8_t b64[200];
  size_t outLen = 0;
  if (mbedtls_base64_encode(b64, sizeof(b64), &outLen, sig, sigLen) != 0) return false;
  sigB64 = String((const char *)b64).substring(0, outLen);
  return true;
}

}  // namespace signer
