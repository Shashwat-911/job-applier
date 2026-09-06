/**
 * bot/integrations/github.js
 * Fetches GitHub profile details, pinned/top repositories, primary languages,
 * and contribution summary for automatic form filling and dashboard metrics.
 */

const { Octokit } = require('@octokit/rest');

/**
 * Fetch GitHub stats for a given username.
 * @param {string} username
 * @param {string} [token] - Optional GitHub personal access token for higher rate limits
 * @returns {Promise<Object>}
 */
async function getGitHubStats(username, token = null) {
  if (!username) {
    return { error: 'Username is required', success: false };
  }

  // Clean username if passed as a full URL
  const cleanUsername = username.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '').trim();

  try {
    const octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN || undefined,
    });

    // 1. User profile
    const { data: user } = await octokit.rest.users.getByUsername({ username: cleanUsername });

    // 2. Repositories
    const { data: repos } = await octokit.rest.repos.listForUser({
      username: cleanUsername,
      sort: 'updated',
      per_page: 30,
    });

    // Compute metrics
    const nonForks = repos.filter(r => !r.fork);
    const topRepos = nonForks
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 5)
      .map(r => ({
        name: r.name,
        description: r.description || '',
        url: r.html_url,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language || 'Unknown',
        updatedAt: r.updated_at,
      }));

    // Aggregate languages
    const langCounts = {};
    for (const repo of nonForks) {
      if (repo.language) {
        langCounts[repo.language] = (langCounts[repo.language] || 0) + 1;
      }
    }

    const totalStars = nonForks.reduce((acc, r) => acc + (r.stargazers_count || 0), 0);

    return {
      success: true,
      username: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      publicRepos: user.public_repos,
      followers: user.followers,
      totalStars,
      topLanguages: Object.entries(langCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang]) => lang),
      topRepos,
      profileUrl: user.html_url,
    };
  } catch (err) {
    console.warn(`[GitHub Integration] Could not fetch stats for ${cleanUsername}:`, err.message);
    return {
      success: false,
      username: cleanUsername,
      error: err.message,
    };
  }
}

module.exports = {
  getGitHubStats,
};
